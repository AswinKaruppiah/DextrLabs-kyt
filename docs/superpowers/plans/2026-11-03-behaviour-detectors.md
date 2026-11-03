# Behaviour Detectors (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag wallets by how they behave (pass-through, collector/distributor, new wallet with big volume, address poisoner, structuring, funded by a listed wallet), even when no bad list names them, and show every screened wallet's age. It also catches the evasion trick of passing money through a row of freshly made wallets (layering) and of one funder making many wallets (wallet factory).

**Architecture:** Detectors are pure functions over the USDT transfer history the exposure engine already fetches (`{cp, dir, usd, ts, tx}`), so they need no new data except one "first funder" lookup. `analyzeBehaviour` runs them and returns indicators with `kind: "BEHAVIOUR"`, and `riskScorer` merges them into the verdict. Behaviour signals are review-grade. On their own they reach at most MEDIUM, and HIGH only when two signals combine or the funder is a sanctioned or frozen wallet. They never produce CRITICAL.

**Tech Stack:** Next.js 16 API route, plain JS ES modules, MongoDB (intel lookups), TronGrid and Alchemy, and Node's built-in test runner (`node:test`, no new dependency).

**Spec:** The P2 list agreed in the 2026-11-03 session (items 11–16). There is no separate spec file; the decisions are recorded here.

## Global Constraints

- No new npm dependencies. Tests use `node:test` and `node:assert/strict`.
- Free data only: TronGrid for TRON, Alchemy for ETH and BSC. No Etherscan free tier.
- USDT only. Detectors read the existing USDT transfer history; the funder lookup reads native TRX/ETH/BNB transfers only to find who paid the first fees.
- Behaviour signals alone never give CRITICAL or "BAD / DO NOT TRANSACT".
- When the wallet is itself listed (sanctioned or frozen), behaviour findings are information only and not scored, matching `networkFindings`.
- Every signal carries a plain-English `reason` that includes the numbers that triggered it.
- New pure modules import siblings with explicit `.js` extensions, so `node --test` can load them outside Next.
- All thresholds live in `BEHAVIOUR_RULES` in `src/lib/exposure/rules.js`. The UI guide imports that file, so the numbers shown match the engine.
- Repo files use LF line endings. Check `git ls-files --eol` after writing new files on Windows.

## Review Focus

1. **Exchange deposit addresses.** Many senders, swept within minutes to one hot wallet. This looks like a collector or pass-through wallet, and users often screen these addresses. Expected: no MEDIUM. Instead an INFO signal "looks like an exchange deposit address" when the sweep target is a hub. Test: `collector pattern sweeping to a hub is suppressed` (Task 2) and the hub check in Task 4.
2. **Truncated history** (busy wallets, newest 1000 per direction only). Expected: the wallet's age comes from the account lookup (Task 3), not from the oldest USDT transfer seen. If that lookup fails, the USDT fallback is used only when history is *not* truncated; otherwise age is "unknown" and the new-wallet detector does not fire. Tests: `newWallet ignores truncated history without createdAt` (Task 2) and `newWallet uses createdAt even when history is truncated` (Task 2).
3. **Empty or dust-only history.** Expected: every detector returns `null`, with no throw or NaN. Test: `all detectors return null on empty and dust-only history` (Task 2).
4. **EVM case differences.** Counterparties are lowercase, and pasted addresses can be checksummed. Expected: lookalike matching is case-insensitive on EVM and case-sensitive on TRON (base58). Test: `poisoningTarget compares EVM case-insensitively` (Task 2).
5. **Layering trace runs out of time** on a long chain (TronGrid is paced at 150 ms per request). Expected: the signal is built from the layers already traced, `coverage.layering === "partial"`, and the screen still returns within ~15 s more. Test: `getHistory throws mid-path` (Task 4).
6. **Funder lookup fails** (API down or no native transfer found). Expected: the screen still completes, `behaviour.coverage.funder` says `"unavailable"`, and the verdict is **not** turned into UNKNOWN (the funder is secondary evidence). Verified in Task 4, Step 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/exposure/rules.js` (modify) | Add `BEHAVIOUR_RULES` thresholds |
| `src/lib/behaviour/detectors.js` (create) | Pure detectors plus `combineSignals` |
| `src/lib/behaviour/detectors.test.mjs` (create) | Unit tests for detectors |
| `src/lib/behaviour/funder.js` (create) | First-funder and wallet-age lookup (TronGrid / Alchemy) plus pure response parsers |
| `src/lib/behaviour/funder.test.mjs` (create) | Parser unit tests |
| `src/lib/behaviour/layering.js` (create) | Follows the main money path through fresh pass-through wallets (dependencies injected, so it is unit-testable) |
| `src/lib/behaviour/layering.test.mjs` (create) | Layering tests with fake wallets |
| `src/lib/behaviour/analyzeBehaviour.js` (create) | Runs detectors and the funder check and returns indicators |
| `src/lib/exposure/exposure.js` (modify) | Export `riskOf`; return `history` from `analyzeExposure` |
| `src/lib/engine/riskScorer.js` (modify) | Merge behaviour indicators into the score |
| `src/components/ScreeningSimulator.jsx` (modify) | "Behaviour" panel |
| `src/components/ScreeningStepsGuide.jsx` (modify) | Explain the behaviour rules |
| `package.json` (modify) | `"test"` script |

## Shared shapes

```js
// A detector result (null = not detected)
{ type: "PASS_THROUGH" | "COLLECTOR" | "DISTRIBUTOR" | "NEW_WALLET_HIGH_VOLUME" | "POISONER"
        | "POISONING_TARGET" | "STRUCTURING" | "FUNDED_BY_LISTED" | "DEPOSIT_ADDRESS"
        | "LAYERED_FROM_LISTED" | "LAYERED_TO_LISTED" | "LAYERING_CHAIN" | "WALLET_FACTORY",
  level: "HIGH" | "MEDIUM" | "INFO",
  reason: string,
  evidence: object }          // the numbers behind the reason, e.g. { medianHoldMinutes, inUsd, outUsd }

// An indicator as returned to the client (built in analyzeBehaviour)
{ id: `IND-BEH-${type}`, kind: "BEHAVIOUR", type, category: "BEHAVIOUR", categoryLabel: string,
  severity: level, score: { HIGH: 75, MEDIUM: 50, INFO: 0 }[level], reason, evidence }
```

---

### Task 1: Thresholds and test runner

**Files:**
- Modify: `src/lib/exposure/rules.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `BEHAVIOUR_RULES`, exported from `src/lib/exposure/rules.js`, with exactly these starting values:

```js
export const BEHAVIOUR_RULES = {
  minVolumeUsd: 1_000,        // detectors ignore wallets that moved less than this in total
  passThroughMaxHoldMin: 60,  // value-weighted median time money stays before leaving
  passThroughRatio: [0.9, 1.1], // out / in must fall in this band
  passThroughMinCycles: 3,    // at least this many in->out matches
  fanMinWallets: 50,          // collector: >= this many senders; distributor: >= this many recipients
  fanMaxOther: 3,             // ...and <= this many on the other side
  fanForwardShare: 0.8,       // collector must forward >= 80% of what it received
  newWalletDays: 7,           // first transfer within this many days...
  newWalletMinUsd: 10_000,    // ...and at least this much moved
  poisonerMaxUsd: 1,          // outgoing transfers below this count as poisoning dust
  poisonerMinTargets: 20,     // ...sent to at least this many different wallets
  poisonerShare: 0.8,         // ...making up >= 80% of the wallet's outgoing transfers
  structuringBands: [1_000, 3_000, 10_000], // amounts in [0.9 * band, band) are "just below"
  structuringMinCount: 5,     // >= this many just-below transfers...
  structuringWindowH: 24,     // ...inside any window of this many hours
  hubCounterparties: 500,     // a wallet with this many counterparties (or truncated both ways) is a hub
  // Layering: money passed through a row of fresh wallets to get past the 2-hop exposure trace
  layeringMaxHops: 6,         // follow the main money path at most this many wallets each way
  layeringDominantShare: 0.5, // follow a counterparty only if it is >= 50% of the wallet's in (or out) flow
  layeringFreshDays: 30,      // a "fresh" layer wallet is at most this old
  layeringMaxHoldH: 24,       // ...and passes money on within this many hours (out/in within passThroughRatio)
  layeringMinLayers: 3,       // this many fresh pass-through wallets in a row is suspicious on its own
  layeringDeadlineMs: 15_000, // whole layering trace; unfinished paths are marked partial
  // Wallet factory: one funder paying the first fees of many new wallets
  factoryMinWallets: 20,      // funder sent first gas to >= this many different wallets...
  factoryWindowDays: 30,      // ...within this many days
};
```

- [ ] **Step 1:** Add `BEHAVIOUR_RULES` (values above) to `rules.js`, below `EXPOSURE_RULES`, with the same comment style.
- [ ] **Step 2:** Add the script `"test": "node --experimental-detect-module --test"` to `package.json`.
- [ ] **Step 3:** Run `npm test`. Expected: it exits 0 and reports "tests 0" (no test files yet).
- [ ] **Step 4:** Commit: `git add src/lib/exposure/rules.js package.json && git commit -m "feat(behaviour): add behaviour thresholds and test script"`

---

### Task 2: Pure detectors

**Files:**
- Create: `src/lib/behaviour/detectors.js`
- Test: `src/lib/behaviour/detectors.test.mjs`

**Interfaces:**
- Consumes: `BEHAVIOUR_RULES` and `EXPOSURE_RULES.dustUsd` from `../exposure/rules.js`.
- Produces (each takes `transfers: Array<{cp, dir, usd, ts, tx}>` and returns a detector result or `null`):
  - `detectPassThrough(transfers)`
  - `detectFanPattern(transfers)`, which returns COLLECTOR, DISTRIBUTOR or null
  - `detectNewWallet(transfers, { createdAt, truncated }, now = Date.now())`. `createdAt` (ms or null) comes from Task 3. When it is null, the detector falls back to the oldest transfer, but only if `truncated` is `{in:false, out:false}`.
  - `walletAgeDays(createdAt, now = Date.now())`, which returns whole days or `null`
  - `detectPoisoner(transfers)`
  - `detectPoisoningTarget(transfers, selfAddress)`
  - `detectStructuring(transfers)`
  - `combineSignals(signals)`, which returns `{ level: "HIGH"|"MEDIUM"|"INFO"|null, combined: boolean }`. The result is HIGH if any signal is HIGH, or if 2 or more signals are MEDIUM (`combined: true`). Otherwise it is the highest level present, or null for an empty list.

Test helper used by all tests: `const t = (cp, dir, usd, minutesAgo) => ({ cp, dir, usd, ts: NOW - minutesAgo * 60_000, tx: cp + minutesAgo })`.

Rules the tests pin (thresholds come from `BEHAVIOUR_RULES`; dust is `usd < EXPOSURE_RULES.dustUsd`):

- [ ] **Step 1: Write the failing tests**

```js
test("passThrough: 3 cycles of $5k in, out after 10 min -> MEDIUM", ...)
  // in A 5000 @t, out B 4950 @t+10m, x3. Expect type PASS_THROUGH, level MEDIUM,
  // evidence.medianHoldMinutes === 10, reason mentions "10 min".
test("passThrough: money held 3 days -> null", ...)
test("passThrough: out/in = 0.5 -> null", ...)
test("fan: 60 senders x $200, forwarded to 1 wallet -> COLLECTOR MEDIUM", ...)
test("fan: 1 sender, 60 recipients -> DISTRIBUTOR MEDIUM", ...)
test("fan: 60 dust senders (< $10) do not count as senders -> null", ...)
test("newWallet: createdAt 2 days ago, $20k moved -> MEDIUM, reason says '2 days old'", ...)
test("newWallet: createdAt 400 days ago, $20k moved -> null", ...)
test("newWallet: no createdAt, oldest transfer 2 days ago, not truncated -> MEDIUM", ...)
test("newWallet ignores truncated history without createdAt", ...)   // createdAt null, truncated {in:true} -> null
test("newWallet uses createdAt even when history is truncated", ...) // createdAt 2 days ago, truncated -> MEDIUM
test("walletAgeDays: 36h ago -> 1; null -> null", ...)
test("poisoner: 25 outgoing $0.001 to 25 wallets -> MEDIUM", ...)
test("poisoningTarget: dust from lookalike of a real counterparty -> INFO", ...)
  // real cp TXyz...9aKp with $500; dust from TXyzQ...9aKp (same first 5 / last 4) -> INFO, evidence.lookalike, evidence.real
test("poisoningTarget compares EVM case-insensitively", ...)
test("structuring: 6 transfers of $950-$999 within 12h -> MEDIUM", ...)
test("structuring: 6 such transfers spread over 10 days -> null", ...)
test("all detectors return null on empty and dust-only history", ...)
test("below minVolumeUsd every detector except poisoner and poisoningTarget returns null", ...)
test("combineSignals: two MEDIUM -> HIGH combined; one MEDIUM + INFO -> MEDIUM; [] -> null", ...)
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (cannot find `./detectors.js`).
- [ ] **Step 3: Implement the detectors in `detectors.js`.** Approach for the parts the tests don't determine:
  - **Pass-through hold time:** sort transfers by `ts` ascending. Keep a FIFO queue of incoming lots (non-dust only). Each outgoing transfer consumes lots from the front, recording `holdMinutes = (out.ts - lot.ts) / 60000` weighted by the USD consumed. Report the value-weighted median. A *cycle* is one outgoing transfer that consumed at least one lot.
  - **Fan pattern:** count distinct non-dust senders and recipients. COLLECTOR: senders ≥ `fanMinWallets`, recipients ≤ `fanMaxOther`, and outUsd ≥ `fanForwardShare` × inUsd. DISTRIBUTOR: the mirror image, without the forward-share rule. `evidence` lists the top 3 forward targets with USD (Task 4 needs `evidence.targets` for the hub check).
  - **Lookalike:** TRON compares the first 5 and last 4 characters case-sensitively. EVM lowercases, then compares chars 2–5 after `0x` and the last 4.
  - **Structuring:** a sliding window over sorted just-below transfers, in either direction.
- [ ] **Step 4:** Run `npm test`. Expected: all detector tests PASS.
- [ ] **Step 5:** Commit: `git add src/lib/behaviour && git commit -m "feat(behaviour): add pure behaviour detectors with tests"`

---

### Task 3: First-funder and wallet-age lookup

**Files:**
- Create: `src/lib/behaviour/funder.js`
- Test: `src/lib/behaviour/funder.test.mjs`

**Interfaces:**
- Consumes: `request` and `jsonRpc` from `../collector/util/http.js`; `tronHexToBase58` and `normalizeAddress` from `../collector/util/address.js`.
- Produces:
  - `parseTronFunder(json, address)` returns `{ funder, ts, tx } | null`
  - `parseEvmFunder(result)` returns `{ funder, ts, tx } | null`
  - `parseTronCreateTime(json)` returns ms or `null`, read from `data[0].create_time`
  - `findFirstFunder(chain, address)` returns `Promise<{ funder, ts, tx } | null>`. It throws on HTTP failure; the caller handles that.
  - `getWalletAge(chain, address, funding /* result of findFirstFunder, or null */)` returns `Promise<{ createdAt: number|null, source: "account" | "first-funding" | "unknown" }>`. It never throws.
  - `parseFundedWallets(chain, raw, now)` returns `{ wallets: number, truncated: boolean }`: the distinct recipients of native TRX/ETH/BNB transfers within `factoryWindowDays`.
  - `countFundedWallets(chain, funder)` returns `Promise<{ wallets, truncated }>`. It reads the funder's newest 200 outgoing native transfers (TRON: `/v1/accounts/${funder}/transactions?only_from=true&limit=200`; EVM: `alchemy_getAssetTransfers` with `fromAddress`, `category: ["external"]`, `order: "desc"`, `maxCount: "0xc8"`). It throws on HTTP failure.

Wallet age rules:
- **TRON:** use the account's `create_time` from `GET ${TRONGRID_HOST}/v1/accounts/${address}` (source `"account"`). If that fails or is empty, use `funding.ts` (source `"first-funding"`).
- **ETH and BSC:** there is no creation time on-chain, so use `funding.ts`, the first native ETH/BNB received (source `"first-funding"`). That is when the wallet got its first gas money, which is its practical "birthday".
- Nothing found → `{ createdAt: null, source: "unknown" }`.

- [ ] **Step 1: Write the failing tests**

```js
test("parseTronFunder: picks oldest TransferContract sent TO the address", ...)
  // fixture: data[] with a TriggerSmartContract first, then TransferContract owner_address 41ab.. to_address = address (hex)
  // expect funder === tronHexToBase58("41ab..."), tx === txID
test("parseTronFunder: no TransferContract -> null", ...)
test("parseEvmFunder: first transfer's from, lowercased; empty transfers -> null", ...)
test("parseTronCreateTime: {data:[{create_time: 1700000000000}]} -> 1700000000000; {data:[]} -> null", ...)
test("parseFundedWallets: 25 TRX sends to 25 wallets in last 10 days -> wallets 25", ...)
test("parseFundedWallets: sends older than factoryWindowDays are not counted", ...)
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `funder.js`.**
  - **TRON:** `GET ${TRONGRID_HOST}/v1/accounts/${address}/transactions?only_to=true&order_by=block_timestamp,asc&limit=20`, sending the `TRON-PRO-API-KEY` header when it is set (as `transferHistory.js` does). The funder is the first `raw_data.contract[0]` of type `TransferContract` whose `parameter.value.to_address` equals the address.
  - **EVM:** `alchemy_getAssetTransfers` with `{ toAddress, category: ["external"], order: "asc", maxCount: "0x1", withMetadata: true }` on the same `ALCHEMY_NETWORKS` hosts.
  - Use `{ retries: 1, timeoutMs: 10_000 }`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/behaviour/funder.js src/lib/behaviour/funder.test.mjs && git commit -m "feat(behaviour): add first-funder lookup"`

---

### Task 4: Layering trace (money passed through fresh wallets)

Why: the exposure trace stops at hop 2. A criminal who sends money through 3 or more freshly made wallets, each passing it on within hours, hides the source. This task follows **only the main money path**, not every counterparty, so it stays cheap: at most `layeringMaxHops` wallets each way.

**Files:**
- Create: `src/lib/behaviour/layering.js`
- Test: `src/lib/behaviour/layering.test.mjs`

**Interfaces:**
- Consumes: `BEHAVIOUR_RULES`; `walletAgeDays` (Task 2).
- Produces: `traceLayering(start, direction /* "back" | "forward" */, deps)`, which returns `Promise<{ layers: Array<{address, ageDays, holdHours, usd}>, end: { address, reason: "listed"|"hub"|"not-a-layer"|"max-hops"|"error"|"deadline", risk? } , partial: boolean }>`.
  - `deps = { getHistory(addr) -> {transfers, truncated}, getAge(addr) -> createdAt|null, getRisk(addr) -> riskOf result|null, deadline: number }`. Real implementations are passed in by `analyzeBehaviour`; the tests pass fakes.
  - `layeringSignal(backResult, forwardResult, startIsLayer)` returns a detector result or null:
    - path reaches a severe-listed wallet (sanctions or freeze) through ≥ 1 fresh layer → `LAYERED_FROM_LISTED` (back) or `LAYERED_TO_LISTED` (forward), **HIGH**. Reason: "Money came from <entity> through N new wallets that each passed it on within hours."
    - reaches an OSINT-listed wallet that way → same types, **MEDIUM**.
    - no listed end, but ≥ `layeringMinLayers` fresh pass-through wallets in a row (counting the screened wallet when `startIsLayer`) → `LAYERING_CHAIN` **MEDIUM**.

Walking rule (per step, from the current wallet):
1. The next wallet is the counterparty with the largest incoming USD (back) or outgoing USD (forward). Follow it only if its share is ≥ `layeringDominantShare`.
2. If `getRisk(next)` is set, stop with `end.reason = "listed"`.
3. If `next` is a hub (counterparties ≥ `hubCounterparties`, or truncated both ways), stop with `"hub"`. Exchanges break the trail, so we stop there and do **not** flag.
4. `next` is a layer only if its age ≤ `layeringFreshDays`, out/in is within `passThroughRatio`, and its median hold ≤ `layeringMaxHoldH`. If not, stop with `"not-a-layer"`.
5. Repeat until `layeringMaxHops` or the `deadline`; then `partial: true`.

- [ ] **Step 1: Write the failing tests** (fake wallets built with the Task 2 helper `t(...)`):

```js
test("back: sanctioned -> 3 fresh pass-through wallets -> screened  =>  LAYERED_FROM_LISTED HIGH, 3 layers", ...)
test("forward: screened -> 2 fresh layers -> OSINT scam wallet  =>  LAYERED_TO_LISTED MEDIUM", ...)
test("4 fresh pass-through wallets, no listed end  =>  LAYERING_CHAIN MEDIUM", ...)
test("chain through a 2-year-old wallet stops there (not-a-layer)  =>  null", ...)
test("chain reaching a hub stops (hub) and is not flagged", ...)
test("split flow (largest counterparty only 30%) is not followed", ...)
test("getHistory throws mid-path  =>  partial, signal from what was traced, no throw", ...)
test("cycle A->B->A does not loop forever", ...)
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `layering.js` per the walking rule. Hold time and out/in reuse the FIFO helper from `detectors.js`, so export it there as `holdStats(transfers) -> { ratio, medianHoldMinutes }`. Keep a visited set for cycles.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/lib/behaviour/layering.js src/lib/behaviour/layering.test.mjs src/lib/behaviour/detectors.js && git commit -m "feat(behaviour): trace money layered through fresh wallets"`

---

### Task 5: `analyzeBehaviour` and scoring

**Files:**
- Create: `src/lib/behaviour/analyzeBehaviour.js`
- Modify: `src/lib/exposure/exposure.js` (export `riskOf`; add `history` to the return value of `analyzeExposure`, including the early "unavailable" return, where it is `null`)
- Modify: `src/lib/engine/riskScorer.js`

**Interfaces:**
- Consumes: the detectors and `combineSignals` (Task 2); `findFirstFunder` (Task 3); `riskOf` and `getTransferHistory`; `lookupAddresses` from `../collector/store.js`.
- Produces: `analyzeBehaviour(chain, address, history)`, which returns `Promise<{ indicators, combined, wallet: { createdAt, ageDays, ageSource, funder }, coverage: { status: "complete"|"skipped", funder: "found"|"none"|"unavailable" } }>`.
  - `history` null → `status: "skipped"`, no indicators. The age lookup still runs, so the age shows even when transfer history failed.
  - `wallet.funder` is `{ address, tx, listed: boolean }` or null.

Rules:
- **Funder.** The funder is looked up in intel with `riskOf`:
  - severe (sanctions or freeze) → `FUNDED_BY_LISTED` HIGH
  - OSINT → MEDIUM
  - not listed → no signal
- **Hub check.** For COLLECTOR or PASS_THROUGH, call `getTransferHistory` (usually a cache hit from hop 2) on the top forward target. If that target is a hub (counterparties ≥ `hubCounterparties`, or truncated both ways), drop the signal and emit `DEPOSIT_ADDRESS` INFO: "Forwards to a high-activity wallet; looks like an exchange deposit address."
- **Combining.** If `combineSignals` says `combined`, add one extra indicator, `COMBINED_BEHAVIOUR` HIGH, whose reason names the signals.
- **Layering.** Run `traceLayering(address, "back", deps)` and `traceLayering(address, "forward", deps)` in parallel, sharing one `deadline = now + layeringDeadlineMs`.
  - `deps.getHistory = getTransferHistory` (cached 24 h).
  - `deps.getAge` = `getWalletAge` on that wallet's `findFirstFunder` result.
  - `deps.getRisk` = `lookupAddresses` + `riskOf`.
  - `startIsLayer` = the screened wallet's own age ≤ `layeringFreshDays` and it passes `holdStats`. A partial trace adds `coverage.layering = "partial"`, but never an UNKNOWN.
- **Wallet factory.** When a funder was found and it is not listed and not a hub, call `countFundedWallets`. If `wallets ≥ factoryMinWallets`, emit `WALLET_FACTORY` MEDIUM: "The wallet that paid this wallet's first fees also paid N other new wallets in 30 days." If the funder has 500+ counterparties it is an exchange withdrawal wallet: skip the check and emit no signal.

- [ ] **Step 1: Implement `analyzeBehaviour.js`** per the rules above:
  - Order: `findFirstFunder`, then `getWalletAge` (which reuses the funding result), running in parallel with the hub check. Then pass `createdAt` to `detectNewWallet`.
  - A funder error sets `coverage.funder = "unavailable"` and never throws.
- [ ] **Step 2: Wire it into `riskScorer.js`** after exposure:
  - `const behaviour = await analyzeBehaviour(effectiveChain, from, exposure?.history ?? null)`.
  - If the sender is listed, set `behaviourFindings = behaviour.indicators` (info only).
  - Otherwise push the indicators into `riskIndicators` and raise `highestScore` like exposure does (`highestCategory` stays the exposure/listing one when the scores are equal).
  - Add `behaviour: { indicators, coverage }` and `wallet: behaviour.wallet` to the response, and do **not** return `history`.
  - When the level comes from behaviour, the summary is `"${riskLevel} RISK on ${chain}: suspicious behaviour — ${top.reason}"`.
- [ ] **Step 3:** Run `npx eslint src/lib` and `npm test`. Expected: both exit 0.
- [ ] **Step 4: Verify on the dev server.** Screen a quiet real wallet (`TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9`). Expected:
  - `behaviour.coverage.status === "complete"` and no BEHAVIOUR indicators
  - `wallet.ageSource === "account"` with a `createdAt` that matches the account's creation date on Tronscan
  - for one ETH wallet, `wallet.ageSource === "first-funding"` Then temporarily make `findFirstFunder` throw. Expected: the screen still returns 200, `coverage.funder === "unavailable"`, and the level is not UNKNOWN. Remove the temporary throw (`git grep TEMP-TEST` must find nothing).
- [ ] **Step 5:** Commit: `git commit -am "feat(behaviour): score behaviour signals in wallet screening"` (after `git add src/lib/behaviour/analyzeBehaviour.js`)

---

### Task 6: UI

**Files:**
- Modify: `src/components/ScreeningSimulator.jsx`
- Modify: `src/components/ScreeningStepsGuide.jsx`

**Interfaces:**
- Consumes: `result.behaviour.indicators`, `result.behaviourFindings` and `result.wallet` (Task 5); `BEHAVIOUR_RULES` (Task 1). Layering signals carry `evidence.layers` for the path drawing.

- [ ] **Step 1: Add `BehaviourPanel({ result })`** next to `ExposurePanel`, reusing `LEVEL_PILL` (add an `INFO` pill style):
  - one card per signal: level pill, `categoryLabel`, `reason`
  - an "Information only" badge when `behaviourFindings` is set
  - the line "Funder lookup unavailable" when `coverage.funder === "unavailable"`
- [ ] **Step 1a: Show layering signals as a path**, one row per wallet: `Sanctioned wallet → new wallet (2 days old, held 15 min) → new wallet (1 day old, held 8 min) → this wallet`, each address linking to the explorer.
- [ ] **Step 1b: Add a "Wallet age" line** to the result header, shown for every result, CRITICAL and UNKNOWN included:
  - with a known age: `Wallet age: 2 years 3 months (created 2024-08-01, from account record)`
  - for an ETH or BSC age source: `... (first gas received)`
  - when unknown: `Wallet age: unknown`
  - under 7 days: amber text, so a brand-new wallet is easy to spot even when it moved little money
  - when a funder is known, a funder link next to it
- [ ] **Step 2: Make the verdict banner text behaviour-aware.** When the top indicator is `kind: "BEHAVIOUR"`, show "Not listed, but behaves like a high-risk wallet. See behaviour below." instead of the exposure sentence.
- [ ] **Step 3:** Add a "Behaviour checks" step to `ScreeningStepsGuide.jsx` listing each detector with its `BEHAVIOUR_RULES` numbers, and add the rule "Behaviour alone is at most MEDIUM; two signals together, or a sanctioned/frozen funder, is HIGH".
- [ ] **Step 4:** Run `npx eslint src/components/ScreeningStepsGuide.jsx`. Expected: exit 0. Open http://localhost:3000, screen the wallet from Task 4, and check that the Behaviour panel renders with no console errors.
- [ ] **Step 5:** Commit: `git commit -am "feat(behaviour): show behaviour findings in screening UI"`

---

## Not in this plan (on purpose)

- **Peel chains where the money splits at every hop.** The layering trace (Task 4) follows the main path, which covers the usual peel chain (most of the money goes on to one new wallet each time). Paths that split evenly into many branches are not followed; that belongs with full "hop 3+" tracing (P3).
- **Clustering wallets by funder into groups.** Task 3 only checks whether *this* wallet's funder is listed. Building owner groups needs a stored graph, which is a later project.
- **Calibration.** Thresholds are starting values. Tune them against known-bad wallets (freeze list, HF fraud set) and known-good ones after the exchange list (P1 #2) exists.
