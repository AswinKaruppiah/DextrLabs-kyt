# Behaviour Patterns

How the wallet screening catches bad wallets that **no list names yet**, by looking at how they move money, how old they are, and who paid their first fees.

These checks run automatically on every wallet screening (`POST /api/kyt/screen`). They are step 3 of the check, after "is the wallet on a list?" and "who did it trade with?":

```
1. Is the wallet on a bad list?     sanctions, Tether / Circle freezes, scam and hack lists
2. Who did it trade with? (2 hops)  money from or to listed wallets
3. How does it move money?          the 8 behaviour patterns below, plus wallet age
4. Result                           BAD / HIGH RISK / CAUTION / GOOD / COULD NOT VERIFY
```

All numbers on this page come from `BEHAVIOUR_RULES` in [src/lib/exposure/rules.js](src/lib/exposure/rules.js). The "How this check works" panel in the UI reads the same file, so it always shows the numbers the engine uses. They are **starting values**, to be tuned against real known-bad and known-good wallets.

---

## The main rule: behaviour is a warning, not proof

Normal people sometimes move money in unusual ways. So behaviour patterns are review signals:

| Situation | Result |
|---|---|
| One behaviour pattern | **CAUTION** at most (score 50, `ENHANCED_DUE_DILIGENCE`) |
| Two or more CAUTION patterns together | **HIGH RISK** (score 75, `MANUAL_REVIEW_SAR`), shown as "Several behaviour red flags" |
| First fees paid by a **sanctioned or frozen** wallet | **HIGH RISK** |
| Money layered from or to a **sanctioned or frozen** wallet through **2 or more** new wallets | **HIGH RISK** |
| Anything from behaviour alone | **Never** BAD / CRITICAL. Only the wallet's own sanctions or freeze listing gives that. |

If the wallet is already sanctioned or frozen, the verdict is already BAD. Behaviour findings are then shown as **"Information only"** and don't change the score.

---

## Wallet age

Shown at the top of every result, for example:

> Wallet age: 2 years 3 months (created 2024-08-01, from account record) • First fees paid by TDQm…XpXke

| Chain | Where the age comes from |
|---|---|
| TRON | The account's creation time (`create_time` from TronGrid) |
| Ethereum, BSC | No creation time exists on-chain, so we use the first time the wallet received ETH / BNB for gas |
| Any chain | If we can see a USDT transfer **older** than that date, the older date wins ("first transfer seen"), because USDT can arrive before the first gas |
| Not found | "unknown". TRON smart-contract accounts have no creation time. |

An age under **7 days** is shown in amber. Age alone never makes a wallet bad; it feeds pattern 3.

---

## The 8 patterns

### 1. Pass-through wallet

**What criminals do:** use a wallet only to pass money on, so the trail is harder to follow.

**Rule:**
- money in and money out are about equal (out ÷ in between **0.9 and 1.1**)
- money stays a short time before leaving (value-weighted median under **60 minutes**)
- this happens **3 or more** times
- the wallet moved at least **$1,000** in total

**Result:** CAUTION. Example reason: *"Money passes straight through: $15,000 in and $14,850 out, typically leaving after 10 min (3 times)."*

**Protecting innocent wallets:** if the money goes to a very busy wallet (an exchange), the wallet is shown as **"Likely exchange deposit address"** for information only, and isn't flagged.

### 2. Collector / distributor

**What criminals do:**
- **Collector:** many victims pay into one wallet, which sends the money on to a few wallets.
- **Distributor:** one wallet pays out to many wallets (money mules).

**Rule:**
- **Collector:** **50+** different wallets send in, it sends to **3 or fewer**, and it forwards at least **80%** of what came in.
- **Distributor:** it sends to **50+** wallets and is funded by **3 or fewer**.
- Transfers under **$10** (dust) don't count, so a poisoning attack can't make a wallet look like a collector.

**Result:** CAUTION.

**Protecting innocent wallets:** a collector that forwards to an exchange is an exchange deposit address, so it's shown for information only.

### 3. New wallet, big money

**What criminals do:** create a fresh wallet and move large amounts through it immediately.

**Rule:** the wallet is under **7 days** old (see Wallet age) and has moved **$10,000** or more.

**Result:** CAUTION. Example: *"Wallet is 2 days old but has already moved $20,000."*

**Protecting innocent wallets:**
- If we don't know the age and the history is too long to read fully, this check doesn't run; we never guess.
- On an exchange deposit address it becomes information only.

### 4. Address poisoner

**What criminals do:** create an address that looks like one you use (same first and last characters) and send you a tiny transfer. You may later copy the fake address from your history by mistake.

**Rule:** the wallet sent tiny transfers (under **$1**) to **20+** different wallets, and these make up **80%+** of its outgoing transfers.

**Result:** CAUTION.

**Related warning (victim side):** if the screened wallet *received* dust from a lookalike of a wallet it really uses, we show **"Targeted by address poisoning"** as information. The wallet isn't bad; it's a victim. The warning also works if the victim already paid the fake address by mistake.

**Lookalike rule:**
- TRON: same first 5 and last 4 characters, case-sensitive.
- EVM: same first 4 hex characters after `0x` and same last 4, case-insensitive.

### 5. Structuring

**What criminals do:** split money into amounts just under a limit to avoid reports.

**Rule:**
- **5 or more** transfers just under a round limit within **24 hours**.
- "Just under" means **90–99.99%** of **$1,000, $3,000 or $10,000**, so $900–$999.99, $2,700–$2,999.99 and $9,000–$9,999.99.
- Incoming and outgoing transfers are counted **separately**, so receiving a payment and forwarding it doesn't count twice.

**Result:** CAUTION.

**Protecting innocent wallets:** very busy wallets (exchanges, payment services) skip this check. They naturally have many such amounts.

### 6. Funded by a bad wallet

**What criminals do:** use their main wallet to pay the first fees (TRX / ETH / BNB) of their new wallets.

**Rule:** find who sent the wallet its first native coin, then look that wallet up in our lists.

| Funder is… | Result |
|---|---|
| sanctioned or frozen | **HIGH RISK** |
| on a scam or hack list | **CAUTION** |
| not listed | nothing (pattern 8 may still apply) |

**Real example:** wallets from the Elliptic Binance-hack list were less than 2 days old, and their first fees were paid by another hacker wallet.

### 7. Layering

**What criminals do:** pass money through a row of brand-new wallets, each forwarding it quickly, so the trail is longer than a normal 2-hop trace:

```
Criminal ──► New wallet ──► New wallet ──► New wallet ──► Screened wallet
             (1 day old,    (1 day old,    (2 days old,
              held 15 min)   held 8 min)    held 20 min)
```

**Rule:** starting from the screened wallet, follow the **main money path** back (where the money came from) and forward (where it went), up to **6 wallets** each way. A step is taken only if:
- one counterparty carries at least **50%** of the money in that direction
- that wallet is **30 days old or less**
- it passed the money on within **24 hours** (out ÷ in between 0.9 and 1.1)

| What the trace finds | Result |
|---|---|
| Reaches a **sanctioned or frozen** wallet through **2+** new wallets | **HIGH RISK** |
| Reaches it through **1** new wallet, or reaches a **scam / hack** wallet | **CAUTION** (one wallet in between may be an unrelated party) |
| **3+** new pass-through wallets in a row, no listed wallet at the end | **CAUTION** |

The UI draws the path, with each wallet's age and how long it held the money.

**The trace stops (no flag) when it reaches:**
- an old normal wallet
- an exchange-like wallet (hub)
- a point where the money splits with no main path
- a wallet it has already visited (cycle)
- the time limit

Going forward, a new wallet that empties straight into an exchange is treated as that exchange's **deposit address** (cashing out), not as one more layer. A wallet seen on both sides of the trace is counted once.

### 8. Wallet factory

**What criminals do:** use one wallet to create many wallets, by paying each new wallet's first fee.

**Rule:**
- this wallet was funded within the last **30 days**
- its funder sent native coin to **20+** wallets in the last **30 days**

**Result:** CAUTION. Example: *"The wallet that paid this wallet's first fees also sent coins to 25 wallets in the last 30 days."*

**Protecting innocent wallets:** exchanges and their gas-filler wallets also fund many wallets (withdrawals, deposit-address top-ups). The funder is treated as an exchange, and not flagged, if:
- it sent so many coins recently that one page (200 sends) doesn't cover the window, or
- its USDT history looks like a hub.

On an exchange deposit address this pattern becomes information only.

---

## Exchanges and busy wallets

Without a full exchange list, the biggest risk is flagging exchanges and the people who use them. These rules prevent that:

| Rule | Where |
|---|---|
| A **hub** has **500+** counterparties (dust not counted), or more history than we read in both directions | `isHub` in [layering.js](src/lib/behaviour/layering.js) |
| A screened wallet that is a hub skips patterns 1, 2, 3 and 5, and shows **"Very busy wallet"** as information | [behaviourCore.js](src/lib/behaviour/behaviourCore.js) |
| A pass-through or collector that forwards to a hub is shown as **"Likely exchange deposit address"** | same |
| Once a deposit address is recognised, patterns 3 and 8 become information only | same |
| Layering stops at hubs and doesn't count the deposit address before them | [layering.js](src/lib/behaviour/layering.js) |
| A funder that funds wallets nonstop is an exchange, not a factory | same as pattern 8 |

---

## Time limit and failures

- All behaviour lookups share one **15-second** limit (`layeringDeadlineMs`). A slow or stuck lookup can't hold up the screening.
- The funder lookup, the exchange checks and the layering trace run **in parallel**.
- A failed lookup never turns the result into "COULD NOT VERIFY". Behaviour is extra evidence; the main checks decide that.
- If the whole behaviour step fails, the screening still returns, with the note *"Behaviour checks failed to run this time"*.

The response field `behaviour.coverage` says what ran:

| Field | Values | Meaning |
|---|---|---|
| `status` | `complete`, `skipped`, `failed` | `skipped` = no transfer history; only age and funder ran |
| `funder` | `found`, `none`, `unavailable` | Was the first-fee payer found |
| `funderChecks` | `complete`, `skipped`, `unavailable` | Could the funder be checked (listed? factory?) |
| `layering` | `complete`, `partial`, `skipped` | `partial` = the time limit or an API error cut the trace short |

---

## Data used

All free, using the same providers as the rest of the screening:

| Data | TRON | Ethereum / BSC |
|---|---|---|
| USDT transfer history (newest 1,000 each way, cached 24 h) | TronGrid | Alchemy Transfers API |
| First fee payer, wallets it funded | TronGrid account transactions | Alchemy `external` transfers |
| Wallet creation time | TronGrid account `create_time` | first gas received |
| Is a wallet listed? | our intel database (MongoDB) | same |

TronGrid requests share one process-wide pacer (150 ms apart), in [src/lib/tron/pacer.js](src/lib/tron/pacer.js).

---

## Code map

| File | What it does |
|---|---|
| [src/lib/exposure/rules.js](src/lib/exposure/rules.js) | `BEHAVIOUR_RULES`: every threshold |
| [src/lib/behaviour/detectors.js](src/lib/behaviour/detectors.js) | Patterns 1–5, poisoning target, wallet age helpers, `combineSignals` (pure functions) |
| [src/lib/behaviour/funder.js](src/lib/behaviour/funder.js) | First fee payer, wallet age, wallets a funder paid |
| [src/lib/behaviour/layering.js](src/lib/behaviour/layering.js) | Pattern 7 trace and signal, `isHub` |
| [src/lib/behaviour/behaviourCore.js](src/lib/behaviour/behaviourCore.js) | Combines everything: patterns 6 and 8, exchange rules, time limit (all lookups injected, so it's testable) |
| [src/lib/behaviour/analyzeBehaviour.js](src/lib/behaviour/analyzeBehaviour.js) | Connects the core to the real APIs and database |
| [src/lib/engine/riskScorer.js](src/lib/engine/riskScorer.js) | Adds behaviour findings to the final score |
| [src/components/ScreeningSimulator.jsx](src/components/ScreeningSimulator.jsx) | Behaviour panel, wallet age line, layering path |

**Tests:** `npm test` runs 63 tests in `src/lib/behaviour/*.test.mjs` with fake wallets; no network is needed.

---

## Known limits

- **Thresholds aren't calibrated yet.** Tune them against known bad wallets (freeze lists, the fraud dataset) and known good ones (exchanges) once an exchange list exists.
- **No exchange list yet.** Exchanges are recognised by how busy they are, not by name, so a quiet exchange wallet can be missed.
- **Busy wallets are read on their newest 1,000 transfers each way** only.
- **Layering follows only the main money path.** Money split evenly into many branches isn't followed; that belongs with deeper multi-hop tracing.
- **Wallet factory checks only whether this wallet's funder funded many wallets.** It doesn't group wallets into owners.
