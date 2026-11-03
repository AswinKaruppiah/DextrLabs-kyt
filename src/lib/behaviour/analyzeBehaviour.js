import { getTransferHistory } from "../exposure/transferHistory.js";
import { riskOf } from "../exposure/exposure.js";
import { lookupAddresses } from "../collector/store.js";
import { normalizeAddress } from "../collector/util/address.js";
import { BEHAVIOUR_RULES as R } from "../exposure/rules.js";
import { findFirstFunder, getWalletAge, countFundedWallets } from "./funder.js";
import { buildBehaviour } from "./behaviourCore.js";

async function riskFor(chain, address) {
  const key = normalizeAddress(address);
  const entry = (await lookupAddresses(chain, [key])).get(key);
  return entry ? riskOf(entry) : null;
}

/** Age of any wallet: TRON account record first, else its first gas received. */
async function createdAtOf(chain, address) {
  const age = await getWalletAge(chain, address, null);
  if (age.createdAt) return age.createdAt;
  return (await findFirstFunder(chain, address))?.ts ?? null;
}

/**
 * Behaviour findings for one wallet: how it moves money, who paid its first fees, whether its
 * money was layered through fresh wallets, and its age. `history` is the transfer history
 * analyzeExposure already fetched (null when it failed). The rules live in behaviourCore.js.
 */
export function analyzeBehaviour(chain, address, history) {
  const now = Date.now();
  return buildBehaviour({
    address: normalizeAddress(address.trim()),
    history,
    now,
    deadline: now + R.layeringDeadlineMs,
    deps: {
      findFirstFunder: (a) => findFirstFunder(chain, a),
      getWalletAge: (a, funding) => getWalletAge(chain, a, funding),
      countFundedWallets: (a) => countFundedWallets(chain, a),
      getHistory: (a) => getTransferHistory(chain, a),
      getRisk: (a) => riskFor(chain, a),
      getAge: (a) => createdAtOf(chain, a),
    },
  });
}
