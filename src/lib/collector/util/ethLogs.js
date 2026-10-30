import { jsonRpc } from "./http.js";

// Stay this many blocks behind the head so a chain reorg can't drop events we already stored.
const CONFIRMATIONS = 12;
// Re-read the whole history this often as a safety net; incremental syncs in between.
const FULL_RESCAN_MS = 7 * 24 * 60 * 60 * 1000;
// A full rescan is only attempted on providers that accept huge ranges (otherwise ~2,000+ calls).
const FULL_SCAN_MIN_RANGE = 1_000_000;

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

/** Rejects a response that isn't a list of logs from the watched contracts (misbehaving node). */
function checkLogs(logs, url, contracts) {
  if (!Array.isArray(logs)) throw new Error(`${label(url)} returned a non-array eth_getLogs result`);
  for (const log of logs) {
    if (!contracts.has(log.address?.toLowerCase()) || !log.topics?.length || !log.data) {
      throw new Error(`${label(url)} returned a log that is not one of the watched events`);
    }
  }
  return logs;
}

const fetchChunk = async (p, from, to, filter) =>
  checkLogs(
    await jsonRpc(
      p.url,
      "eth_getLogs",
      [{ address: filter.address, fromBlock: hex(from), toBlock: hex(to), topics: [filter.topics] }],
      { retries: 1 },
    ),
    p.url,
    filter.contracts,
  );

/**
 * Reads [fromBlock, toBlock], chunked per provider, failing over chunk by chunk.
 * Watched events are rare, so most chunks are legitimately empty — but a lagging or pruned node
 * also answers "[]". Every empty chunk is therefore re-asked of a second provider; if that one
 * finds events, its answer wins.
 */
async function getLogs(fromBlock, toBlock, filter, { minRange = 0, providers: all = PROVIDERS } = {}) {
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
        let chunk = await fetchChunk(p, cursor, end, filter);
        used.add(label(p.url));
        if (!chunk.length) {
          const second = all.find((q) => q !== p && q.maxRange >= end - cursor + 1);
          if (!second) emptyChecks.unconfirmed++;
          else {
            try {
              const recheck = await fetchChunk(second, cursor, end, filter);
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

/**
 * Event logs of one or more contracts, read incrementally. The first run (and a weekly safety
 * rescan) reads the full history from `startBlock`; every other run only reads blocks since the
 * previous run's `notes.lastBlock`, which any free RPC can serve.
 * Logs are returned sorted by block / log index.
 * @returns {{ full: boolean, logs: object[], notes: object }}  full = rebuild state from scratch;
 *   notes = the fields to store (and resume from) in the source's notes
 */
export async function syncContractLogs({ previous, startBlock, address, topics }) {
  const addresses = [].concat(address);
  const filter = { address: addresses, topics, contracts: new Set(addresses.map((a) => a.toLowerCase())) };
  const { head } = await headBlock();
  const safeHead = head - CONFIRMATIONS;

  // Which contracts/events were read. When a source starts watching a new contract or event,
  // history read under the old filter lacks those logs, so the next run rescans from startBlock.
  const filterKey = `${[...filter.contracts].sort().join(",")}|${[...topics].sort().join(",")}`;

  const prevNotes = previous?.notes || {};
  const canResume = Number.isInteger(prevNotes.lastBlock) && previous?.records?.length > 0;
  const rescanDue =
    !canResume ||
    prevNotes.filterKey !== filterKey ||
    !prevNotes.lastFullScanAt ||
    Date.now() - Date.parse(prevNotes.lastFullScanAt) > FULL_RESCAN_MS;

  let mode;
  let fetched;
  let lastFullScanAt = prevNotes.lastFullScanAt || null;

  if (rescanDue) {
    try {
      fetched = await getLogs(startBlock, safeHead, filter, { minRange: FULL_SCAN_MIN_RANGE });
      mode = "full";
      lastFullScanAt = new Date().toISOString();
    } catch (err) {
      // Big-range providers unavailable: fall back to incremental if we have something to resume.
      if (!canResume) throw err;
      mode = "incremental (full rescan failed: " + err.message + ")";
    }
  }
  if (!fetched) {
    fetched =
      prevNotes.lastBlock >= safeHead
        ? { logs: [], providers: [], emptyChecks: null }
        : await getLogs(prevNotes.lastBlock + 1, safeHead, filter);
    mode ??= "incremental";
  }

  const logs = fetched.logs.sort(
    (a, b) =>
      parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
      parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16),
  );
  return {
    full: mode === "full",
    logs,
    notes: {
      mode,
      fromBlock: mode === "full" ? startBlock : prevNotes.lastBlock + 1,
      lastBlock: safeHead,
      lastFullScanAt,
      // Only a completed full scan proves the history matches this filter.
      filterKey: mode === "full" ? filterKey : prevNotes.filterKey,
      events: logs.length,
      providers: fetched.providers,
      emptyChecks: fetched.emptyChecks,
    },
  };
}
