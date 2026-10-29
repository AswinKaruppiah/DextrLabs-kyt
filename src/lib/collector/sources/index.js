import { ofacSdn } from "./ofacSdn.js";
import { ofacMirror } from "./ofacMirror.js";
import { euFsf } from "./euFsf.js";
import { ukSanctions } from "./ukSanctions.js";
import { unConsolidated } from "./unConsolidated.js";
import { ilNbctf } from "./ilNbctf.js";
import { fbiIc3 } from "./fbiIc3.js";
import { tetherTron } from "./tetherTron.js";
import { tetherEth } from "./tetherEth.js";
import { circleEth, paxosEth, tusdEth } from "./stablecoinFreezes.js";
import { judicialFraud } from "./judicialFraud.js";
import { ethLabels, ethLabelsExploits, fortaLabels, mewDarklist, scamSniffer } from "./osint.js";
import { defiHackLabs } from "./defiHackLabs.js";

/**
 * Every collection source, highest tier first.
 *  Tier 1 — government sanctions / seizure orders / law-enforcement attributions
 *  Tier 2 — stablecoin issuer freezes
 *  Tier 3 — court-documented fraud addresses
 *  Tier 4 — OSINT / security-vendor scam & hack labels
 */
export const SOURCES = [
  ofacSdn,
  ofacMirror,
  euFsf,
  ukSanctions,
  unConsolidated,
  ilNbctf,
  fbiIc3,
  tetherTron,
  tetherEth,
  circleEth,
  paxosEth,
  tusdEth,
  judicialFraud,
  scamSniffer,
  mewDarklist,
  ethLabels,
  ethLabelsExploits,
  fortaLabels,
  defiHackLabs,
];

export const getSource = (id) => SOURCES.find((s) => s.id === id);
