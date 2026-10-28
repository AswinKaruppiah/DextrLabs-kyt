import { jsonRpc } from "../util/http.js";
import { CHAINS } from "../util/address.js";

const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DEPLOY_BLOCK = 4_634_748;
// Stay this many blocks behind the head so a chain reorg can't drop events we already stored.
const CONFIRMATIONS = 12;
// Re-read the whole history this often as a safety net; incremental syncs in between.
const FULL_RESCAN_MS = 7 * 24 * 60 * 60 * 1000;
// A full rescan is only attempted on providers that accept huge ranges (otherwise ~2,000+ calls).
const FULL_SCAN_MIN_RANGE = 1_000_000;

// keccak256 event signatures (verified live against the USDT contract).
const TOPIC = {
  ADDED: "0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc", // AddedBlackList(address)
  REMOVED: "0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c", // RemovedBlackList(address)
  DESTROYED: "0x61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6", // DestroyedBlackFunds(address,uint256)
};

/**
 * Tried in order; on any error the same block range moves on to the next provider.
 * maxRange = largest eth_getLogs block span the provider accepts (measured 2026-10-28).
 * ETH_RPC_URL (e.g. a personal Tenderly / Alchemy / Infura URL with the key in it) goes first.
 */
const PROVIDERS = [
  process.env.ETH_RPC_URL && {
    url: process.env.ETH_RPC_URL,
    maxRange: Number(process.env.ETH_RPC_MAX_RANGE) || 2_000_000,
  },
  { url: "https://gateway.tenderly.co/public/mainnet", maxRange: 2_000_000 },
  { url: "https://mainnet.gateway.tenderly.co", maxRange: 2_000_000 },
  // Keyless nodes below only serve recent blocks / small ranges: fine for incremental syncs.
  { url: "https://ethereum-rpc.publicnode.com", maxRange: 5_000 },
  { url: "https://rpc.mevblocker.io", maxRange: 5_000 },
  { url: "https://eth.drpc.org", maxRange: 50 },
].filter(Boolean);

const hex = (n) => "0x" + n.toString(16);
const label = (url) => new URL(url).host;

async function headBlock() {
  let lastErr;
  for (const p of PROVIDERS) {
    try {
      return { head: parseInt(await jsonRpc(p.url, "eth_blockNumber", [], { retries: 1 }), 16), via: p.url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Rejects a response that isn't a list of logs from the USDT contract (misbehaving node). */
function checkLogs(logs, url) {
  if (!Array.isArray(logs)) throw new Error(`${label(url)} returned a non-array eth_getLogs result`);
  for (const log of logs) {
    if (log.address?.toLowerCase() !== USDT_ERC20.toLowerCase() || !log.topics?.length || !log.data) {
      throw new Error(`${label(url)} returned a log that is not a USDT blacklist event`);
    }
  }
  return logs;
}

const fetchChunk = async (p, from, to) =>
  checkLogs(
    await jsonRpc(
      p.url,
      "eth_getLogs",
      [
        {
          address: USDT_ERC20,
          fromBlock: hex(from),
          toBlock: hex(to),
          topics: [[TOPIC.ADDED, TOPIC.REMOVED, TOPIC.DESTROYED]],
        },
      ],
      { retries: 1 },
    ),
    p.url,
  );

/**
 * Reads [fromBlock, toBlock], chunked per provider, failing over chunk by chunk.
 * Freeze events are rare, so most chunks are legitimately empty — but a lagging or pruned node
 * also answers "[]". Every empty chunk is therefore re-asked of a second provider; if that one
 * finds events, its answer wins.
 */
async function getLogs(fromBlock, toBlock, { minRange = 0, providers: all = PROVIDERS } = {}) {
  const providers = all.filter((p) => p.maxRange >= minRange);
  if (!providers.length) throw new Error(`no provider accepts ${minRange}-block ranges`);
  const logs = [];
  const used = new Set();
  const emptyChecks = { confirmed: 0, unconfirmed: 0, corrected: 0 };
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    let done = false;
    let lastErr;
    for (const p of providers) {
      const end = Math.min(cursor + p.maxRange - 1, toBlock);
      try {
        let chunk = await fetchChunk(p, cursor, end);
        used.add(label(p.url));
        if (!chunk.length) {
          const second = all.find((q) => q !== p && q.maxRange >= end - cursor + 1);
          if (!second) emptyChecks.unconfirmed++;
          else {
            try {
              const recheck = await fetchChunk(second, cursor, end);
              used.add(label(second.url));
              if (recheck.length) {
                chunk = recheck;
                emptyChecks.corrected++;
              } else emptyChecks.confirmed++;
            } catch {
              emptyChecks.unconfirmed++;
            }
          }
        }
        logs.push(...chunk);
        cursor = end + 1;
        done = true;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!done) throw new Error(`all Ethereum RPCs failed for blocks ${cursor}+: ${lastErr?.message}`);
  }
  return { logs, providers: [...used], emptyChecks };
}

/** Applies freeze events (sorted by block/logIndex) on top of the current frozen-address map. */
function applyEvents(state, logs) {
  logs.sort(
    (a, b) =>
      parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
      parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16),
  );
  let added = 0;
  let removed = 0;
  for (const log of logs) {
    const address = "0x" + log.data.slice(26, 66);
    if (log.topics[0] === TOPIC.ADDED) {
      if (!state.has(address)) added++;
      state.set(address, {
        addedTx: log.transactionHash,
        addedBlock: parseInt(log.blockNumber, 16),
        destroyed: false,
      });
    } else if (log.topics[0] === TOPIC.REMOVED) {
      if (state.delete(address)) removed++;
    } else if (log.topics[0] === TOPIC.DESTROYED && state.has(address)) {
      state.get(address).destroyed = true;
    }
  }
  return { added, removed };
}

/** Frozen-address map from the previous snapshot's records. */
function stateFromSnapshot(previous) {
  const state = new Map();
  for (const r of previous?.records || []) {
    state.set(r.address, {
      addedTx: r.reference?.id,
      addedBlock: r.details?.frozenAtBlock,
      destroyed: !!r.details?.fundsDestroyed,
    });
  }
  return state;
}

/**
 * Current USDT-ERC20 blacklist. The first run (and a weekly safety rescan) reads the full
 * event history since 2017; every other run only reads blocks since the last sync, which
 * any free RPC can serve, so no single provider is a point of failure.
 */
export const tetherEth = {
  id: "tether-usdt-eth",
  name: "Tether USDT (ERC-20) frozen addresses",
  authority: "Tether Operations Ltd — on-chain blacklist",
  jurisdiction: "ISSUER",
  tier: 2,
  confidence: 90,
  category: "ISSUER_FREEZE",
  license: "Public on-chain data",
  homepage: `https://etherscan.io/token/${USDT_ERC20}`,
  mirror: false,
  // A full history scan is ~12 two-million-block calls plus re-checks.
  timeoutMs: 6 * 60 * 1000,

  async collect({ previous } = {}) {
    const { head } = await headBlock();
    const safeHead = head - CONFIRMATIONS;

    const prevNotes = previous?.notes || {};
    const canResume = Number.isInteger(prevNotes.lastBlock) && previous?.records?.length > 0;
    const rescanDue =
      !canResume || !prevNotes.lastFullScanAt || Date.now() - Date.parse(prevNotes.lastFullScanAt) > FULL_RESCAN_MS;

    let mode;
    let state;
    let fetched;
    let lastFullScanAt = prevNotes.lastFullScanAt || null;

    if (rescanDue) {
      try {
        fetched = await getLogs(DEPLOY_BLOCK, safeHead, { minRange: FULL_SCAN_MIN_RANGE });
        state = new Map();
        mode = "full";
        lastFullScanAt = new Date().toISOString();
      } catch (err) {
        // Big-range providers unavailable: fall back to incremental if we have something to resume.
        if (!canResume) throw err;
        mode = "incremental (full rescan failed: " + err.message + ")";
      }
    }
    if (!fetched) {
      if (prevNotes.lastBlock >= safeHead) {
        fetched = { logs: [], providers: [], emptyChecks: null };
      } else {
        fetched = await getLogs(prevNotes.lastBlock + 1, safeHead);
      }
      state = stateFromSnapshot(previous);
      mode ??= "incremental";
    }

    const { added, removed } = applyEvents(state, fetched.logs);

    const items = [...state].map(([address, s]) => ({
      address,
      statedChain: CHAINS.ETHEREUM,
      entity: "Tether-frozen address",
      asset: "USDT",
      reference: { id: s.addedTx, url: `https://etherscan.io/tx/${s.addedTx}` },
      details: { frozenAtBlock: s.addedBlock, fundsDestroyed: s.destroyed },
    }));

    return {
      items,
      sourceDate: `block ${safeHead}`,
      notes: {
        mode,
        fromBlock: mode === "full" ? DEPLOY_BLOCK : prevNotes.lastBlock + 1,
        lastBlock: safeHead,
        lastFullScanAt,
        events: fetched.logs.length,
        newlyFrozen: added,
        unfrozen: removed,
        providers: fetched.providers,
        emptyChecks: fetched.emptyChecks,
      },
    };
  },
};
