# Sanctions Intelligence & Screening Architecture

How **DextrLabs-KYT** collects risk addresses and uses them to screen USDT activity on **TRON**, **Ethereum** and **BNB Smart Chain (BSC)**.

> Every external data source (URLs, formats, pricing, licenses, docs) is listed in **[DATA_SOURCES.md](DATA_SOURCES.md)**. This document covers how the data flows through the app.

---

## 1. Principles

1. **One address database.** All wallet intelligence lives in the MongoDB Atlas collection `intel_wallets`, built by the collector. Screening and the directory UI read the same collection. There are no hardcoded wallet lists in the code.
2. **Primary sources, free, commercially usable.** Government lists are pulled directly from OFAC, the EU, UK FCDO, the UN and Israel NBCTF. OpenSanctions is **not** used, because its license is non-commercial.
3. **Every flag shows its sources.** Each address carries every source that flagged it: authority, program, reference link, listing date, and whether the chain was named by the source (`listed`) or applied by EVM mirroring (`evm-mirror`).
4. **Severity by tier.** Tier 1 (sanctions) and Tier 2 (Tether freezes) block. Tier 4 (OSINT) sends the address to review and never blocks on its own.
5. **USDT chains only.** TRON, Ethereum and BSC. Bitcoin and other chains are rejected during collection.

---

## 2. Data flow

```
     Government lists              Issuer freezes              Court records          OSINT
 OFAC · EU · UK · UN · NBCTF   Tether TRON · Tether ETH       Judicial fraud      ScamSniffer · MEW · eth-labels
        · FBI IC3              Circle · Paxos · TUSD (ETH)    labels (TRON)       Forta · DeFiHackLabs
             │                          │                          │                    │
             └──────────────────────────┼──────────────────────────┴────────────────────┘
                                        ▼
                     src/lib/collector  (npm run collect:intel)
                     - validate (TRON checksum / EVM hex)
                     - EVM mirroring ETH ⇄ BSC (sanctions only)
                     - merge per chain:address, keep every source
                     - keep current listings if a feed fails
                                        │
                                        ▼
                     MongoDB Atlas  intel_wallets (~21.6k, only changed wallets written)
                                    intel_sync_runs   (each run: time, status, warnings, errors)
                                    intel_run_wallets (wallets each run changed + source)
                                    intel_sync_errors (every source failure: when, which, why)
                                        │
                     src/lib/collector/store.js  (queries; directory newest first)
                     ┌──────────────────┴───────────────────┐
                     ▼                                      ▼
      Screening  POST /api/kyt/screen          Directory  GET  /api/kyt/intel
      riskScorer → entityAttribution                      POST /api/kyt/intel/sync
                     │                                      │
             ScreeningSimulator.jsx            SanctionedWalletsDirectory.jsx
```

---

## 3. Screening pipeline

[`resolveEntity(address, chain)`](src/lib/intelligence/entityAttribution.js) checks each address in this order and returns the first match:

| Step | Check | Backed by | Risk category | Score | Action |
|---|---|---|---|---|---|
| 1 | **Live Tether freeze (TRON only)**: `getBlackListStatus(address)` on `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` via TronGrid | On-chain RPC | `TETHER_FROZEN` | 100 | Block |
| 1b | Tether freeze as of the last collection (TRON and ETH) | [`tetherBlacklist.js`](src/lib/intelligence/tetherBlacklist.js) → intel `ISSUER_FREEZE` | `TETHER_FROZEN` | 100 | Block |
| 2 | **Government sanctions** (OFAC, EU, UK, UN, NBCTF) | [`sanctionsRegistry.js`](src/lib/intelligence/sanctionsRegistry.js) → intel `SANCTIONS` | `SANCTIONS_OFAC` | 100 | Block |
| 3 | Tether freeze with no sanctions match | Steps 1 and 1b | `TETHER_FROZEN` | 100 | Block |
| 4 | **OSINT hack / exploit** label | intel `HACK_EXPLOIT` | `EXCHANGE_EXPLOIT` | 82 | Review |
| 4 | **OSINT scam / phishing** label | intel `SCAM_PHISHING` | `PHISHING_SCAM` | 75 | Review |
| 5 | Regulated exchange hot wallet | `REGULATED_EXCHANGES` (**empty, no data source yet**) | `REGULATED_EXCHANGE` | 5 | Approve |
| 6 | Nothing matched | — | `CLEAN_UNHOSTED` | 10 | Approve |

If an address is both sanctioned and Tether-frozen, both are shown as evidence. Lookups are exact by **chain and address**. For example, an Ethereum Tether freeze does not flag the same address on BSC, while an Ethereum sanctions listing does, through EVM mirroring.

[`riskScorer.js`](src/lib/engine/riskScorer.js) then combines the sender, the recipient and the hop exposure into a 0–100 score and a recommended action.

---

## 4. API endpoints

### `POST /api/kyt/screen`
Screens a wallet or a transaction.
```json
{ "chain": "TRON", "from": "TAkpWPt2JZdiLSkG7ZX2VAQkZQsnGZ1nqh", "amountUsdt": 1000 }
```
Returns the risk score, risk level, recommended action, provider badges (`US-OFAC`, `EU`, `UK-FCDO`, `UN`, `IL-NBCTF`, `TETHER ON-CHAIN`, OSINT authorities), evidence and the flow path.

### `GET /api/kyt/intel`
Search, filter and page the address database.
Query: `search`, `chain` (`ALL|TRON|ETHEREUM|BSC`), `category` (`ALL|SANCTIONS|ISSUER_FREEZE|HACK_EXPLOIT|SCAM_PHISHING`), `source` (collector source id), `page`, `limit` (max 200).
Returns the items, counts per filter, and the health of each source.

### `POST /api/kyt/intel/sync`
Starts a background collection of every source and returns `202` with the job right away; if one is already running, returns that job (`started: false`). Optional JSON body: `only` (source ids) and `acceptShrink` (source ids whose blocked drop should be accepted).

### `GET /api/kyt/intel/sync`
The running job (per-source status and progress) or the last finished one, with totals and warnings. See *Consistency guarantees* in [DATA_SOURCES.md](DATA_SOURCES.md).

---

## 5. Known gaps

| Gap | Impact | Next step |
|---|---|---|
| **FBI-attributed Lazarus Group (DPRK) addresses** | 11 Ethereum addresses that the old OpenSanctions feed `us_fbi_lazarus_crypto` provided are not covered | Add a source that parses FBI / IC3 public service announcements (US government, public domain) |
| `REGULATED_EXCHANGES` is empty | Exchange hot wallets are scored as unhosted (10) instead of regulated (5) | Add an exchange-label source |
| Data is only as fresh as the last collection | Freezes or designations made after the last sync are missed (TRON freezes are still caught live) | Schedule `npm run collect:intel`, e.g. hourly |
| No transaction-graph expansion | Only listed addresses are flagged, not their funders or sweep wallets | Attribution expansion phase |
| Empty `intel_wallets` | Screening would approve everything | Run `npm run collect:intel` once against a new database |
