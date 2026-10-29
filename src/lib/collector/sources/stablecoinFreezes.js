import { CHAINS } from "../util/address.js";
import { syncContractLogs } from "../util/ethLogs.js";

// keccak256 event signatures (verified live against each contract on 2026-10-29).
// Every one of these events carries the affected address as topic 1.
const TOPIC = {
  BLACKLISTED: "0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855", // Blacklisted(address)
  UNBLACKLISTED: "0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e", // UnBlacklisted(address)
  FROZEN: "0x90811a8edd3b3c17eeaefffc17f639cc69145d41a359c9843994dc2538203690", // AddressFrozen(address)
  UNFROZEN: "0xc3776b472ebf54114339eec9e4dc924e7ce307a97f5c1ee72b6d474e6e5e8b7c", // AddressUnfrozen(address)
  WIPED: "0xfc5960f1c5a5d2b60f031bf534af053b1bf7d9881989afaeb8b1d164db23aede", // FrozenAddressWiped(address)
  BLACKLIST_SET: "0xcf3473b85df1594d47b6958f29a32bea0abff9dd68296f7bf33443646793cfd8", // Blacklisted(address,bool)
};

/**
 * Applies freeze events (sorted by block/logIndex) to a map address -> { asset -> freeze }.
 * `events` maps topic -> "freeze" | "unfreeze" | "wipe" | "set" (bool in data: true = freeze).
 */
function applyEvents(state, logs, { contracts, events }) {
  let added = 0;
  let removed = 0;
  for (const log of logs) {
    const asset = contracts[log.address.toLowerCase()];
    const address = "0x" + log.topics[1].slice(26).toLowerCase();
    let action = events[log.topics[0]];
    if (action === "set") action = BigInt(log.data) === 0n ? "unfreeze" : "freeze";
    const freezes = state.get(address) || {};
    if (action === "freeze") {
      if (!Object.keys(freezes).length) added++;
      freezes[asset] = { tx: log.transactionHash, block: parseInt(log.blockNumber, 16), fundsWiped: false };
      state.set(address, freezes);
    } else if (action === "unfreeze" && freezes[asset]) {
      delete freezes[asset];
      if (!Object.keys(freezes).length) {
        state.delete(address);
        removed++;
      }
    } else if (action === "wipe" && freezes[asset]) {
      freezes[asset].fundsWiped = true;
    }
  }
  return { added, removed };
}

/** Frozen-address map from the previous result's records (the current listings in the database). */
function stateFromSnapshot(previous) {
  const state = new Map();
  for (const r of previous?.records || []) {
    if (r.details?.freezes) state.set(r.address, structuredClone(r.details.freezes));
  }
  return state;
}

/**
 * One stablecoin issuer's on-chain freeze list on Ethereum, rebuilt from its contracts' events
 * the same way as the Tether ERC-20 list (full history first, then incremental).
 */
function issuerFreezeSource({ id, name, authority, issuer, contracts, events, startBlock }) {
  const byAddress = Object.fromEntries(Object.entries(contracts).map(([a, asset]) => [a.toLowerCase(), asset]));
  return {
    id,
    name,
    authority,
    jurisdiction: "ISSUER",
    tier: 2,
    confidence: 90,
    category: "ISSUER_FREEZE",
    license: "Public on-chain data",
    homepage: `https://etherscan.io/token/${Object.keys(contracts)[0]}`,
    mirror: false,
    timeoutMs: 6 * 60 * 1000,

    async collect({ previous } = {}) {
      const sync = await syncContractLogs({
        previous,
        startBlock,
        address: Object.keys(contracts),
        topics: Object.keys(events),
      });
      const state = sync.full ? new Map() : stateFromSnapshot(previous);
      const { added, removed } = applyEvents(state, sync.logs, { contracts: byAddress, events });

      // Issuers also freeze their own token contracts (so tokens can't get stuck there); those aren't wallets.
      const items = [...state].filter(([address]) => !byAddress[address]).map(([address, freezes]) => {
        const assets = Object.keys(freezes).sort();
        const first = freezes[assets[0]];
        return {
          address,
          statedChain: CHAINS.ETHEREUM,
          entity: `${issuer}-frozen address (${assets.join(", ")})`,
          programs: assets.map((a) => `${a} freeze`),
          reference: { id: first.tx, url: `https://etherscan.io/tx/${first.tx}` },
          details: { freezes },
        };
      });
      return {
        items,
        sourceDate: `block ${sync.notes.lastBlock}`,
        notes: { ...sync.notes, newlyFrozen: added, unfrozen: removed },
      };
    },
  };
}

export const circleEth = issuerFreezeSource({
  id: "circle-usdc-eurc-eth",
  name: "Circle USDC / EURC (ERC-20) frozen addresses",
  authority: "Circle Internet Financial — on-chain blacklist",
  issuer: "Circle",
  contracts: {
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "USDC",
    "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c": "EURC",
  },
  events: { [TOPIC.BLACKLISTED]: "freeze", [TOPIC.UNBLACKLISTED]: "unfreeze" },
  startBlock: 6_082_465, // USDC deployment
});

export const paxosEth = issuerFreezeSource({
  id: "paxos-usdp-pyusd-eth",
  name: "Paxos USDP / PayPal PYUSD (ERC-20) frozen addresses",
  authority: "Paxos Trust Company — on-chain freeze list",
  issuer: "Paxos",
  contracts: {
    "0x8E870D67F660D95d5be530380D0eC0bd388289E1": "USDP",
    "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8": "PYUSD",
  },
  events: { [TOPIC.FROZEN]: "freeze", [TOPIC.UNFROZEN]: "unfreeze", [TOPIC.WIPED]: "wipe" },
  startBlock: 6_000_000, // before USDP (Paxos Standard) launched
});

export const tusdEth = issuerFreezeSource({
  id: "tusd-eth",
  name: "TrueUSD TUSD (ERC-20) blacklisted addresses",
  authority: "TrueUSD (Techteryx) — on-chain blacklist",
  issuer: "TrueUSD",
  contracts: { "0x0000000000085d4780B73119b644AE5ecd22b376": "TUSD" },
  events: { [TOPIC.BLACKLIST_SET]: "set" },
  startBlock: 6_000_000, // before the current TUSD contract was deployed
});
