import { jsonRpc } from "../util/http.js";
import { CHAINS } from "../util/address.js";

const USDT_ERC20 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DEPLOY_BLOCK = 4_634_748;
const CHUNK = 2_000_000;

// keccak256 event signatures (verified live against the USDT contract).
const TOPIC = {
  ADDED: "0x42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc", // AddedBlackList(address)
  REMOVED: "0xd7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c", // RemovedBlackList(address)
  DESTROYED: "0x61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6", // DestroyedBlackFunds(address,uint256)
};

// Free, keyless endpoints that accept wide eth_getLogs ranges. ETH_RPC_URL overrides.
const RPCS = [
  process.env.ETH_RPC_URL,
  "https://gateway.tenderly.co/public/mainnet",
  "https://mainnet.gateway.tenderly.co",
].filter(Boolean);

const hex = (n) => "0x" + n.toString(16);

async function getLogs(fromBlock, toBlock) {
  let lastErr;
  for (const rpc of RPCS) {
    try {
      return await jsonRpc(rpc, "eth_getLogs", [
        {
          address: USDT_ERC20,
          fromBlock: hex(fromBlock),
          toBlock: hex(toBlock),
          topics: [[TOPIC.ADDED, TOPIC.REMOVED, TOPIC.DESTROYED]],
        },
      ]);
    } catch (err) {
      lastErr = err;
      // Range/result-size errors: split the range instead of trying the next RPC.
      if (err.rpc && toBlock - fromBlock > 1000 && /range|limit|too many|exceed/i.test(err.message)) {
        const mid = Math.floor((fromBlock + toBlock) / 2);
        return [...(await getLogs(fromBlock, mid)), ...(await getLogs(mid + 1, toBlock))];
      }
    }
  }
  throw lastErr;
}

/**
 * Rebuilds the current USDT-ERC20 blacklist from the full event history:
 * an address is frozen if its latest Added/Removed event is AddedBlackList.
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

  async collect() {
    const head = parseInt(await jsonRpc(RPCS[0], "eth_blockNumber", []), 16);
    const logs = [];
    for (let from = DEPLOY_BLOCK; from <= head; from += CHUNK) {
      logs.push(...(await getLogs(from, Math.min(from + CHUNK - 1, head))));
    }
    logs.sort(
      (a, b) =>
        parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
        parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16),
    );

    const state = new Map(); // address -> { frozen, addedTx, addedBlock, destroyed }
    for (const log of logs) {
      const address = "0x" + log.data.slice(26, 66);
      const s = state.get(address) || { frozen: false, destroyed: false };
      if (log.topics[0] === TOPIC.ADDED) {
        Object.assign(s, { frozen: true, addedTx: log.transactionHash, addedBlock: parseInt(log.blockNumber, 16) });
      } else if (log.topics[0] === TOPIC.REMOVED) {
        s.frozen = false;
      } else if (log.topics[0] === TOPIC.DESTROYED) {
        s.destroyed = true;
      }
      state.set(address, s);
    }

    const items = [];
    let unfrozen = 0;
    for (const [address, s] of state) {
      if (!s.frozen) {
        unfrozen++;
        continue;
      }
      items.push({
        address,
        statedChain: CHAINS.ETHEREUM,
        entity: "Tether-frozen address",
        asset: "USDT",
        reference: { id: s.addedTx, url: `https://etherscan.io/tx/${s.addedTx}` },
        details: { frozenAtBlock: s.addedBlock, fundsDestroyed: s.destroyed },
      });
    }
    return { items, sourceDate: `block ${head}`, notes: { events: logs.length, unfrozen } };
  },
};
