/**
 * Exposure screening thresholds. Kept free of server imports so the UI's "How this check works"
 * panel shows the same numbers the engine uses.
 * Starting values, to be calibrated against known bad (freeze lists, HF fraud set) and good (exchange) wallets.
 */
export const EXPOSURE_RULES = {
  historyLimit: 1000, // newest transfers read per direction (one Alchemy call / five TronGrid pages)
  dustUsd: 10, // incoming transfers below this are ignored: dusting / address poisoning hits victims
  dustSumUsd: 100, // ...unless the small transfers from one wallet add up to this (a payment split into pieces)
  highUsd: 1_000, // direct exposure at or above this amount...
  highPct: 10, // ...or this share of the wallet's volume is HIGH (sanctions / freezes)
  hop2FanOut: 5, // hop 2 follows only this many of the largest clean counterparties
  hop2MinUsd: 100, // ...and only those that moved at least this much with the wallet
  hop2DeadlineMs: 12_000, // hop 2 fetches still running after this are dropped (result marked partial)
  graphExtraHop1: 10, // the graph also shows this many other large hop-1 counterparties; the rest become one "+N" node
  graphMaxNodes: 50, // graph size limit: listed wallets (and the route to them) are placed first, clean wallets fill the rest
};

/**
 * Behaviour detector thresholds (how a wallet moves money, not who it dealt with).
 * Starting values, to be calibrated like EXPOSURE_RULES.
 */
export const BEHAVIOUR_RULES = {
  minVolumeUsd: 1_000, // detectors ignore wallets that moved less than this in total
  passThroughMaxHoldMin: 60, // value-weighted median time money stays before leaving
  passThroughRatio: [0.9, 1.1], // out / in must fall in this band
  passThroughMinCycles: 3, // at least this many in -> out matches
  fanMinWallets: 50, // collector: >= this many senders; distributor: >= this many recipients
  fanMaxOther: 3, // ...and <= this many on the other side
  fanForwardShare: 0.8, // collector must forward >= 80% of what it received
  newWalletDays: 7, // first activity within this many days...
  newWalletMinUsd: 10_000, // ...and at least this much moved
  poisonerMaxUsd: 1, // outgoing transfers below this count as poisoning dust
  poisonerMinTargets: 20, // ...sent to at least this many different wallets
  poisonerShare: 0.8, // ...making up >= 80% of the wallet's outgoing transfers
  structuringBands: [1_000, 3_000, 10_000], // amounts in [0.9 * band, band) are "just below"
  structuringMinCount: 5, // >= this many just-below transfers...
  structuringWindowH: 24, // ...inside any window of this many hours
  hubCounterparties: 500, // a wallet with this many counterparties is a hub...
  hubMinCounterpartiesTruncated: 50, // ...or with this many, if it also has more history than we read both ways
  // Layering: money passed through a row of fresh wallets to get past the 2-hop exposure trace
  layeringMaxHops: 6, // follow the main money path at most this many wallets each way
  layeringDominantShare: 0.5, // follow a counterparty only if it is >= 50% of the wallet's in (or out) flow
  layeringFreshDays: 30, // a "fresh" layer wallet is at most this old
  layeringMaxHoldH: 24, // ...and passes money on within this many hours (out/in within passThroughRatio)
  layeringMinLayers: 3, // this many fresh pass-through wallets in a row is suspicious on its own
  layeringDeadlineMs: 15_000, // whole layering trace; unfinished paths are marked partial
  // Wallet factory: one funder paying the first fees of many new wallets
  factoryMinWallets: 20, // funder sent first gas to >= this many different wallets...
  factoryWindowDays: 30, // ...within this many days
  // Mixer-like contract (ETH / BSC only): an unlisted contract that works like a mixer pool
  mixerCandidates: 5, // the largest counterparties checked for being a contract
  mixerMinWallets: 20, // >= this many different depositors AND >= this many different recipients
  mixerMinDeposits: 20, // >= this many incoming (non-dust) transfers...
  mixerFixedShare: 0.8, // ...of which >= 80% use the same few exact amounts (pool sizes)
  mixerMaxDenominations: 3, // "few" = at most this many different amounts
};
