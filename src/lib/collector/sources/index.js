import { ofacSdn } from "./ofacSdn.js";
import { ofacMirror } from "./ofacMirror.js";
import { euFsf } from "./euFsf.js";
import { ukSanctions } from "./ukSanctions.js";
import { unConsolidated } from "./unConsolidated.js";
import { ilNbctf } from "./ilNbctf.js";
import { tetherTron } from "./tetherTron.js";
import { tetherEth } from "./tetherEth.js";
import { ethLabels, fortaLabels, mewDarklist, scamSniffer } from "./osint.js";

/**
 * Every collection source, highest tier first.
 *  Tier 1 — government sanctions / seizure orders
 *  Tier 2 — stablecoin issuer freezes
 *  Tier 4 — OSINT / security-vendor scam & hack labels
 */
export const SOURCES = [
  ofacSdn,
  ofacMirror,
  euFsf,
  ukSanctions,
  unConsolidated,
  ilNbctf,
  tetherTron,
  tetherEth,
  scamSniffer,
  mewDarklist,
  ethLabels,
  fortaLabels,
];

export const getSource = (id) => SOURCES.find((s) => s.id === id);
