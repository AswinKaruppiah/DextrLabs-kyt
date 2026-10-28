import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_UA = "Mozilla/5.0 (compatible; DextrLabs-KYT-Collector/2.0)";

// Carries the running source's abort signal into every request/sleep it makes, so a source
// that hits its time limit stops its in-flight downloads instead of running on in the background.
const sourceContext = new AsyncLocalStorage();

/** Runs `fn` with `signal` as the cancel signal for every request() / sleep() inside it. */
export const runWithSignal = (signal, fn) => sourceContext.run({ signal }, fn);

const currentSignal = () => sourceContext.getStore()?.signal || null;

export const sleep = (ms) =>
  new Promise((resolve, reject) => {
    const signal = currentSignal();
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * fetch with timeout + retry. Retries on network errors, 429 and 5xx.
 * Returns the Response (caller reads the body).
 */
export async function request(url, { retries = 3, timeoutMs = 90_000, headers = {}, ...init } = {}) {
  const outer = currentSignal();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, {
        redirect: "follow",
        ...init,
        headers: { "User-Agent": DEFAULT_UA, ...headers },
        signal: outer ? AbortSignal.any([outer, timeout]) : timeout,
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
        err.fatal = true;
        throw err;
      }
      return res;
    } catch (err) {
      if (outer?.aborted) throw outer.reason;
      lastErr = err;
      if (err.fatal || attempt === retries) break;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function fetchText(url, opts) {
  return (await request(url, opts)).text();
}

export async function fetchJson(url, opts) {
  return (await request(url, opts)).json();
}

export async function jsonRpc(url, method, params, opts = {}) {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    ...opts,
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(`RPC ${method}: ${body.error.message || JSON.stringify(body.error)}`);
    err.rpc = body.error;
    throw err;
  }
  return body.result;
}
