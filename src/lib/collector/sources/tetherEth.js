import { CHAINS } from "../util/address.js";
import { syncContractLogs } from "../util/ethLogs.js";

const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DEPLOY_BLOCK = 4_634_748;

// keccak256 event signatures (verified live against the USDT contract).
const TOPIC = {
  ADDED: "0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc", // AddedBlackList(address)
  REMOVED: "0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c", // RemovedBlackList(address)
  DESTROYED: "0x61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6", // DestroyedBlackFunds(address,uint256)
};

/** Applies freeze events (sorted by block/logIndex) on top of the current frozen-address map. */
function applyEvents(state, logs) {
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

/** Frozen-address map from the previous result's records (the current listings in the database). */
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
    const sync = await syncContractLogs({
      previous,
      startBlock: DEPLOY_BLOCK,
      address: USDT_ERC20,
      topics: [TOPIC.ADDED, TOPIC.REMOVED, TOPIC.DESTROYED],
    });
    const state = sync.full ? new Map() : stateFromSnapshot(previous);
    const { added, removed } = applyEvents(state, sync.logs);

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
      sourceDate: `block ${sync.notes.lastBlock}`,
      notes: { ...sync.notes, newlyFrozen: added, unfrozen: removed },
    };
  },
};
