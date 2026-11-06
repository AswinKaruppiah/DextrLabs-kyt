import { jsonRpc } from "../collector/util/http.js";
import { alchemyUrl } from "../chains/alchemy.js";

// Ethereum block number -> timestamp (ms). Blocks never change, so entries are kept for the process.
const blockTimes = (globalThis.__kytBlockTimes ??= new Map());

async function blockTime(block) {
  if (!blockTimes.has(block)) {
    const p = jsonRpc(alchemyUrl("ETHEREUM"), "eth_getBlockByNumber", ["0x" + block.toString(16), false], {
      retries: 1,
      timeoutMs: 10_000,
    }).then((b) => parseInt(b.timestamp, 16) * 1000);
    blockTimes.set(block, p);
    p.catch(() => blockTimes.delete(block));
  }
  return blockTimes.get(block);
}

/**
 * When the earliest active issuer freeze of an intel entry took effect (ms), or null if unknown.
 * Tether TRON records the time (`listedAt`); the Ethereum freeze lists record the block
 * (`frozenAtBlock` for Tether, `freezes[asset].block` for Circle / Paxos / TUSD).
 */
export async function freezeTime(entry) {
  const times = [];
  const blocks = [];
  for (const s of entry.sources) {
    if (s.category !== "ISSUER_FREEZE" || s.status === "removed") continue;
    const ts = s.listedAt ? Date.parse(s.listedAt) : NaN;
    if (Number.isFinite(ts)) times.push(ts);
    blocks.push(s.details?.frozenAtBlock, ...Object.values(s.details?.freezes || {}).map((f) => f?.block));
  }
  const known = blocks.filter(Number.isFinite);
  if (known.length) {
    try {
      times.push(await blockTime(Math.min(...known)));
    } catch {
      // Unknown freeze time: the transfers count in full.
    }
  }
  return times.length ? Math.min(...times) : null;
}
