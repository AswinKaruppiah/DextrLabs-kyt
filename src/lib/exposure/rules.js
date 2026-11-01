/**
 * Exposure screening thresholds. Kept free of server imports so the UI's "How this check works"
 * panel shows the same numbers the engine uses.
 * Starting values, to be calibrated against known bad (freeze lists, HF fraud set) and good (exchange) wallets.
 */
export const EXPOSURE_RULES = {
  historyLimit: 1000, // newest transfers read per direction (one Alchemy call / five TronGrid pages)
  dustUsd: 10, // incoming transfers below this are ignored: dusting / address poisoning hits victims
  highUsd: 1_000, // direct exposure at or above this amount...
  highPct: 10, // ...or this share of the wallet's volume is HIGH (sanctions / freezes)
  hop2FanOut: 5, // hop 2 follows only this many of the largest clean counterparties
  hop2MinUsd: 100, // ...and only those that moved at least this much with the wallet
  hop2DeadlineMs: 12_000, // hop 2 fetches still running after this are dropped (result marked partial)
  graphExtraHop1: 10, // the graph also shows this many other large hop-1 counterparties; the rest become one "+N" node
  graphMaxNodes: 50, // graph size limit: listed wallets (and the route to them) are placed first, clean wallets fill the rest
};
