// TronGrid answers bursts with 429 and a ~30 s penalty, so request starts are spaced out
// process-wide (all screenings share the one API key).
const TRONGRID_GAP_MS = 150;
const tronPacer = (globalThis.__kytTronPacer ??= { next: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for this request's turn; call before every TronGrid request. */
export async function tronSlot() {
  const now = Date.now();
  const at = Math.max(now, tronPacer.next);
  tronPacer.next = at + TRONGRID_GAP_MS;
  if (at > now) await sleep(at - now);
}
