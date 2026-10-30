# Data Sources — Threat Intelligence Collector

This document lists every external service the KYT collector pulls data from: what each one provides, what it costs, where its documentation is, and where the collected data is stored.

> **Scope:** USDT risk addresses on **TRON, Ethereum and BSC** only.
> **Token rule (2026-10-30):** USDT is the core. Wallet-level lists (sanctions, hacks, scams) are token-agnostic and in scope. For issuer **freeze lists** we keep only Tether USDT plus the three major USD stablecoin lists already built (Circle USDC/EURC, Paxos USDP/PYUSD, TrueUSD) — they catch risky wallets Tether hasn't frozen (≈16% of the wallets only they flag have used USDT). **No other token freeze lists are added** (PAXG, BUSD, USDG, cbBTC, kBTC, JPYSC, OKB, StablR, …).
> **Cost:** every source below is **free**. No paid API, subscription or API key is required.
> **Last verified:** 2026-10-29 (sources 1–19) and 2026-10-30 (`hf-eth-fraud`, `poison-hunter`, `drainer-daas`, `lazarus-tayvano`). Counts below are from those runs.

---

## 1. Quick reference

| # | Source id | Provider | Tier | What it gives | Format | Auth | Price | Addresses |
|---|---|---|---|---|---|---|---|---|
| 1 | `ofac-sdn` | US Treasury OFAC | 1 | Sanctioned wallets (SDN list) | XML (~29 MB) | None | Free | 588 |
| 2 | `ofac-0xb10c` | 0xB10C (GitHub) | 1 | Nightly extract of OFAC addresses (cross-check) | JSON | None | Free | 588 |
| 3 | `eu-fsf` | European Commission | 1 | EU sanctions (addresses inside free-text remarks) | XML (~25 MB) | None | Free | 7 |
| 4 | `uk-sanctions-list` | UK FCDO | 1 | UK sanctions (addresses inside free-text fields) | CSV (~50 MB) | None | Free | 56 |
| 5 | `un-consolidated` | UN Security Council | 1 | UN sanctions (no addresses today, scanned anyway) | XML (~2 MB) | None | Free | 0 |
| 6 | `il-nbctf` | Israel NBCTF (Ministry of Defense) | 1 | Crypto seizure & forfeiture orders | CSV (form export) | Anti-forgery token (automatic) | Free | 706 |
| 7 | `tether-usdt-tron` | TronScan API | 2 | Tether USDT-TRC20 frozen addresses | JSON (paginated) | Optional key | Free | 8,035 |
| 8 | `tether-usdt-eth` | Ethereum RPC (Tenderly public gateway) | 2 | Tether USDT-ERC20 frozen addresses (rebuilt from events) | JSON-RPC logs | None | Free | 2,828 |
| 9 | `scamsniffer` | ScamSniffer (GitHub) | 4 | Drainer / phishing addresses (frozen since 2024-02) | JSON | None | Free | 4,599 |
| 10 | `mew-darklist` | MyEtherWallet (GitHub) | 4 | Community darklist | JSON | None | Free | 652 |
| 11 | `eth-labels-phish-hack` | dawsbot/eth-labels (GitHub) | 4 | Etherscan "Phish / Hack" labels | JSON | None | Free | 5,594 |
| 12 | `forta-labelled` | Forta Network (GitHub) | 4 | Phishing EOAs + malicious contracts and their deployers | CSV | None | Free | 7,891 |
| 13 | `fbi-ic3` | FBI IC3 public service announcements | 1 | Addresses the FBI attributes to hacks / laundering (Bybit, DPRK Lazarus) | HTML | None | Free | 51 (×2 with BSC mirror) |
| 14 | `circle-usdc-eurc-eth` | Ethereum RPC | 2 | Circle USDC + EURC frozen addresses (rebuilt from events) | JSON-RPC logs | None | Free | 667 |
| 15 | `paxos-usdp-pyusd-eth` | Ethereum RPC | 2 | Paxos USDP + PayPal PYUSD frozen addresses (rebuilt from events) | JSON-RPC logs | None | Free | 320 |
| 16 | `tusd-eth` | Ethereum RPC | 2 | TrueUSD blacklisted addresses (rebuilt from events) | JSON-RPC logs | None | Free | 4 |
| 17 | `judicial-fraud-labels` | Mendeley Data (research dataset) | 3 | TRON fraud-platform and money-laundering broker wallets named in court judgments | CSV | None | Free (CC BY 4.0) | 642 |
| 18 | `eth-labels-exploits` | dawsbot/eth-labels (GitHub, branch v1) | 4 | BSC heist/scam labels + Ethereum incident-exploit labels (Bybit, WazirX, …) | CSV | None | Free | 306 |
| 19 | `defihacklabs` | SunWeb3Sec/DeFiHackLabs (GitHub) | 4 | Exploit attacker wallets and attack contracts (Ethereum + BSC incidents) | Solidity file headers | None | Free | 1,021 |
| 20 | `hf-eth-fraud` | fesevu/ethereum_fraud_dataset_by_activity (Hugging Face) | 4 | Aggregated Ethereum phishing / scam / hack labels (wallets and phishing contracts) | CSV, zstd-compressed | None | Free (CC BY 4.0) | 51,348 (39,210 new) |
| 21 | `poison-hunter` | DS2L/Poison-Hunter (GitHub, ACM CCS'24) | 4 | Ethereum address-poisoning look-alike / attacker addresses | TXT + CSV | None | Free (no licence file) | 6,019 (6,016 new) |
| 22 | `drainer-daas` | blocksecteam/DaaS_dataset (GitHub, IMC'25) | 4 | Drainer-as-a-Service operators, affiliates and profit-sharing contracts | TXT (`.log`) | None | Free (no licence file) | 8,051 (6,724 new) |
| 23 | `lazarus-tayvano` | tayvano/lazarus-bluenoroff-research (GitHub) | 4 | Lazarus / DPRK heist, laundering and IT-worker wallets | Markdown write-ups | None | Free (CC0) | 7,278 (6,882 new): ETH 6,665 · TRON 399 · BSC 215 |

**Tiers**
- **Tier 1:** government sanctions, seizure orders and law-enforcement attributions. A sanctions match blocks.
- **Tier 2:** stablecoin issuer freezes. The issuer has acted on the address, so it is high risk.
- **Tier 3:** court-documented fraud addresses.
- **Tier 4:** OSINT, community and vendor labels. These raise the risk score but must never block on their own.
- Tier 5 is reserved for community reports such as Chainabuse (not implemented).

**Totals (merged, de-duplicated per chain, active):** 85,232 entries: 9,106 TRON, 75,135 Ethereum and 991 BSC (2026-10-30, after adding `hf-eth-fraud`, `poison-hunter`, `drainer-daas` and `lazarus-tayvano` and fixing the Paxos `FreezeAddress` bug; before them: 26,328).

### 1.1 Price and how often new data arrives

The collector only fetches when a sync runs (the **Sync Feeds** button or `npm run collect:intel`); there is no schedule yet. The rates below are **measured** on 2026-10-29 over the last ~6 months (on-chain events, stored listing dates, GitHub commit history), not taken from the publishers' claims. Every source is free; none needs a paid plan.

| Source | Price | New data per month (measured) | Last new data | Our URL is the current one? |
|---|---|---|---|---|
| `tether-usdt-tron` — Tether TRON freezes | Free (optional TronScan key) | **≈ 230–530 wallets** (≈ 10–17 a day) | 2026-10-28 | ✅ TronScan stablecoin blacklist API |
| `tether-usdt-eth` — Tether ETH freezes | Free | **≈ 35–55 wallets** | 2026-10-28 | ✅ USDT contract events |
| `circle-usdc-eurc-eth` — Circle freezes | Free | **≈ 5–310 wallets** (bursty; 557 in 6 months) | 2026-10-28 | ✅ USDC + EURC contract events |
| `defihacklabs` — exploit attackers | Free (Apache-2.0) | **≈ 15–35 new incidents** | 2026-10-29 | ✅ `main` branch |
| `ofac-sdn` — US OFAC SDN | Free | Whole list: several times a week. **Crypto addresses: about monthly** (TRON list changed 10× since June) | 2026-10-28 | ✅ OFAC Sanctions List Service |
| `ofac-0xb10c` — OFAC extract | Free (MIT) | Same as OFAC, ≈ 1 day later | 2026-10-29 | ✅ `lists` branch |
| `il-nbctf` — Israel seizure orders | Free | **≈ 1 new order a month** (11 in 2025, 7 so far in 2026), each with many wallets | 2026 | ✅ |
| `uk-sanctions-list` — UK FCDO | Free (OGL v3) | Whole list: several times a week; crypto addresses rare | report 2026-10-27 | ✅ single UK Sanctions List CSV |
| `eu-fsf` — EU sanctions | Free | With each EU package; crypto addresses rare | file 2026-10-23 | ✅ FSF XML |
| `un-consolidated` — UN | Free | Irregular; no crypto addresses so far | file 2026-10-28 | ✅ |
| `fbi-ic3` — FBI announcements | Free (public domain) | One-off notices; a new notice is added to `fbiIc3.js` by hand | 2025-02-26 | ✅ |
| `eth-labels-exploits` — eth-labels CSV | Free (MIT) | About twice a year | 2026-07-10 | ✅ `v1` branch (maintained) |
| `judicial-fraud-labels` — court judgments | Free (CC BY 4.0, credit required) | Only when the authors publish a new version (v1 Jun 2026, v3 Aug 2026) | 2026-08-03 | ✅ latest version via API |
| `paxos-usdp-pyusd-eth` — Paxos freezes | Free | **≈ 10 freeze events a month** (268 `FreezeAddress` events since mid-2024; many wallets are frozen on both tokens). Earlier "0" was our bug: the upgraded contracts emit `FreezeAddress`, which the collector did not read until 2026-10-30 | 2026-10-30 | ✅ |
| `tusd-eth` — TrueUSD freezes | Free | **0 in the last 6 months** | 2024 | ✅ |
| `scamsniffer` — ScamSniffer | Free (GPL-3.0) | **0 — address lists frozen.** The repo updates daily with phishing *domains* only; fresh addresses are only in their paid real-time API | 2024-02 (addresses) | ✅ `all.json → address` (largest frozen copy) |
| `eth-labels-phish-hack` — eth-labels JSON | Free (MIT) | **0 — frozen** (no maintained replacement: the `v1` export has no Ethereum phish-hack label) | 2022-05-19 | ⚠️ legacy `master` branch, kept as a static snapshot |
| `mew-darklist` — MyEtherWallet | Free (MIT) | **0 — frozen** | 2020-11-18 | ✅ |
| `forta-labelled` — Forta | Free (MIT) | **0 — frozen** | 2023-01-26 | ✅ |
| `hf-eth-fraud` — Hugging Face fraud dataset | Free (CC BY 4.0, credit required) | **0 — static** (one release) | 2025-08 | ✅ `addr_labels_balanced.csv.zst` |
| `poison-hunter` — Poison-Hunter | Free (no licence file) | **0 — static** (one release) | 2025-04 | ✅ `main` branch |
| `drainer-daas` — Drainer-as-a-Service | Free (no licence file) | **0 — static** (one release) | 2025-11 | ✅ `main` branch |
| `lazarus-tayvano` — Lazarus / DPRK notes | Free (CC0) | **New write-ups as DPRK heists happen** (repo commits weekly or more) | 2026-10-30 | ✅ `main` branch |

**In short:** new wallets come mainly from **Tether TRON (hundreds a month), Tether ETH and Circle (tens to hundreds), Paxos (about ten), DeFiHackLabs and OFAC**. TUSD rarely freezes. Four OSINT lists (≈ 19k wallets) are frozen in time — their wallets stay in the database and are still screened, but nothing new will come from them; a daily sync is enough to keep up with every live source.

---

## 2. Where the data lives

Everything is in **MongoDB Atlas** (`MONGODB_URI`, database `MONGODB_DB`, default `dextrlabs_kyt`). Nothing is written to local disk.

| Collection | Contents |
|---|---|
| `intel_wallets` | MERGED database — one document per chain:address (`_id` = key), with every source that flagged it |
| `intel_sync_runs` | One document per run: `status` (running / done / failed), `startedAt`, `finishedAt`, per-source status + error + notes, totals, warnings, OFAC cross-check. The newest `done` run is the current feed status |
| `intel_run_wallets` | One document per wallet a run changed: `runId`, `change` (added / delisted / relisted / source-added / source-removed), the wallet's basic info, and the source listings involved |
| `intel_sync_errors` | One document per source that failed during a run (written the moment it fails), or per run that crashed: when, which source, error type, full message with its underlying cause, stack, and what happened to that source's data |

**Only changed wallets are written.** Each run rebuilds the merged entries in memory, compares each with the stored copy, and upserts only the ones that differ. A run with no changes writes no wallets. Changed wallets get `updatedAt`.

**No local cache.** What used to come from per-source snapshot files is rebuilt from the database at the start of each run: a source's current listings are its active entries in `intel_wallets`, and its status and `notes` (e.g. the Ethereum block reached) come from the last `done` run in `intel_sync_runs`.

Useful queries:
```js
db.intel_sync_runs.find().sort({ startedAt: -1 })                       // run history, errors, warnings
db.intel_run_wallets.find({ runId: ObjectId("…"), change: "added" })     // wallets a run added, with their source
db.intel_run_wallets.find({ key: "TRON:T…" }).sort({ runAt: -1 })        // change history of one wallet
db.intel_sync_errors.find().sort({ failedAt: -1 })                       // latest failures
db.intel_sync_errors.find({ sourceId: "tether-usdt-tron" }).sort({ failedAt: -1 })  // one source's failures
```

Raw downloads (XML, CSV, HTML) are **not** stored, only the normalized records. To inspect the raw data, open the source URL from section 3 in a browser.

### Code

| Path | Purpose |
|---|---|
| [src/lib/collector/sources/](src/lib/collector/sources/) | One module per source (fetch and parse) |
| [src/lib/collector/sources/index.js](src/lib/collector/sources/index.js) | Registry of all sources. Add new sources here |
| [src/lib/collector/run.js](src/lib/collector/run.js) | Runs sources, validates addresses, merges, writes changed wallets to MongoDB |
| [src/lib/collector/db.js](src/lib/collector/db.js) | MongoDB connection (one client per process) and indexes |
| [src/lib/collector/store.js](src/lib/collector/store.js) | Read and query layer: `queryIntel()` for the directory API (newest first), `lookupAddress(chain, address)` for screening |
| [src/lib/intelligence/sanctionsRegistry.js](src/lib/intelligence/sanctionsRegistry.js), [tetherBlacklist.js](src/lib/intelligence/tetherBlacklist.js), [entityAttribution.js](src/lib/intelligence/entityAttribution.js) | Screening lookups (sanctions, Tether freeze, OSINT) backed by `lookupAddress` |
| [src/lib/collector/util/](src/lib/collector/util/) | HTTP retry, address validation (TRON checksum), CSV/XML/text parsing |
| [scripts/collect-intel.mjs](scripts/collect-intel.mjs) | CLI entry point |
| [src/app/api/kyt/intel/route.js](src/app/api/kyt/intel/route.js) | `GET /api/kyt/intel`: search, filter and page the database |
| [src/app/api/kyt/intel/sync/route.js](src/app/api/kyt/intel/sync/route.js) | `POST /api/kyt/intel/sync`: re-run the collection |
| [src/components/SanctionedWalletsDirectory.jsx](src/components/SanctionedWalletsDirectory.jsx) | UI: Global Sanctioned Wallets Directory |

### Running it

```bash
npm run collect:intel                                       # all sources (~90 s)
npm run collect:intel -- --only=ofac-sdn,tether-usdt-tron   # selected sources only
npm run collect:intel -- --only=eu-fsf --accept-shrink=eu-fsf  # accept a blocked drop (see below)
```

The **Sync Feeds** button in the UI does the same thing as the first command, but as a background job: the button returns at once and the page shows each source's progress (`GET /api/kyt/intel/sync`). The run continues if the page is closed or refreshed. The CLI exits with code 1 if any source was not fresh or a drop was blocked.

### Consistency guarantees
- **One run at a time.** A run is recorded in `intel_sync_runs` with `status: "running"`, and a unique index allows only one such document, so it acts as the lock for the web app and the CLI (on any machine). A second click joins the running job; a second CLI run exits with "another collection is already running". A run still "running" after 20 minutes is treated as crashed: it is marked `failed` and taken over.
- **Time limit per source** (default 4 min; TronScan 8 min, Tether ETH 6 min). A source that runs over is cancelled, including its in-flight downloads, and keeps its current listings. The other sources still finish and the database is rebuilt.
- **Shrink guard.** Each fresh result is compared with the source's current listings in `intel_wallets`. If the record count drops by more than 10% (sanctions), 5% (Tether freezes) or 30% (OSINT), the new result is discarded, the current listings are kept, and a warning with the counts and an **Accept new data** button (re-runs that source and accepts the drop) appears in the UI. Accept it only after checking the publisher really delisted the addresses (e.g. OFAC's Tornado Cash delisting).
- **Format checks.** Every parser throws if the publisher's file no longer has the expected structure (missing records, renamed columns), so a format change shows up as `stale` with a reason instead of an empty source.
- **TronScan completeness.** A pass must read every row TronScan reports; if the list changes mid-read the pass is retried (up to 3 times). Never accepted short.
- **Ethereum empty results.** Every empty `eth_getLogs` chunk is re-asked of a second node; if that one finds freeze events, its answer is used (`notes.emptyChecks`). Logs from any other contract are rejected.
- **Warnings** (stale/failed sources, blocked drops, OFAC cross-check mismatch) are written to the run's `intel_sync_runs` document → `warnings` and shown above the source list.
- **Wallets before run record.** Changed wallets are written first, then `intel_run_wallets`, and the run is marked `done` last, so the directory's "Collected" time never runs ahead of the data. If a run dies mid-write, the next run compares again and writes whatever is still different.

---

## 3. Source details

### 3.1 OFAC SDN List (`ofac-sdn`)

| | |
|---|---|
| Provider | US Department of the Treasury, Office of Foreign Assets Control |
| Data URL | `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML` (redirects to a signed S3 URL) |
| Browse | https://sanctionssearch.ofac.treas.gov/ |
| Docs | https://ofac.treasury.gov/sanctions-list-service · https://ofac.treasury.gov/sdn-list-data-formats-data-schemas |
| Format | XML. Addresses are in `<sdnEntry><idList><id>` where `<idType>` is `Digital Currency Address - <ASSET>` |
| Assets used | `TRX`, `ETH`, `BSC`, `BNB`, `USDT`, `USDC`, `ARB`. Bitcoin-based USDT (Omni) and `bnb1…` addresses are rejected as out of scope |
| Pricing | Free, public domain |
| Rate limits | None observed |
| Update frequency | Whenever OFAC publishes, often several times a week |
| Output | `intel_wallets` → `sources.sourceId: "ofac-sdn"` |
| Reference link per address | `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=<uid>` |

### 3.2 OFAC addresses, 0xB10C extract (`ofac-0xb10c`)

| | |
|---|---|
| Provider | 0xB10C, open-source GitHub project |
| Data URL | `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_<ASSET>.json` |
| Docs | https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses |
| Format | JSON array of addresses, one file per asset (`TRX`, `ETH`, `BSC`, `USDT`, `USDC`, `ARB`) |
| Pricing | Free, MIT license |
| Update frequency | Nightly (GitHub Actions at 00:00 UTC) |
| Why it exists | An independent second parse of OFAC. `intel_sync_runs → crossCheck.ofac` lists any address only one of the two parses found. It should be empty; the 2026-10-28 run had 0 differences. It also serves as a fallback if treasury.gov is down |
| Output | `intel_wallets` → `sources.sourceId: "ofac-0xb10c"` |

### 3.3 EU Consolidated Financial Sanctions List (`eu-fsf`)

| | |
|---|---|
| Provider | European Commission (FPI), Financial Sanctions Files |
| Data URL | `https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw` |
| Docs | https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions |
| Format | XML. **The EU has no wallet field.** Addresses appear in free-text `<remark>` elements, e.g. `Known Garantex blockchain wallet addresses: ETH: 0x… BSC: 0x… TRX: T…`. The chain is taken from the nearest label before each address |
| Pricing | Free, EU public data (reuse permitted with attribution) |
| Output | `intel_wallets` → `sources.sourceId: "eu-fsf"` |

### 3.4 UK Sanctions List (`uk-sanctions-list`)

| | |
|---|---|
| Provider | UK Foreign, Commonwealth & Development Office (FCDO). Replaced the old OFSI consolidated list |
| Data URL | `https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv` |
| Docs | https://www.gov.uk/government/publications/the-uk-sanctions-list |
| Browse | https://search-uk-sanctions-list.service.gov.uk/ |
| Format | CSV. Line 1 is `Report Date: …`, and the header row is line 2. There is one row per name alias, grouped by `Unique ID`. Addresses are in free text (mainly `Other Information`), e.g. `(1) ETH: 0x… (2) BNB: 0x… (3) USDT: T…` |
| Pricing | Free, Open Government Licence v3.0 |
| Note | The old OFSI URL (`ofsistorage.blob.core.windows.net/…/ConList.csv`) now returns 409 *PublicAccessNotPermitted*. Don't use it |
| Output | `intel_wallets` → `sources.sourceId: "uk-sanctions-list"` |

### 3.5 UN Security Council Consolidated List (`un-consolidated`)

| | |
|---|---|
| Provider | United Nations Security Council |
| Data URL | `https://scsanctions.un.org/resources/xml/en/consolidated.xml` |
| Docs | https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list |
| Format | XML (`<INDIVIDUAL>` / `<ENTITY>` blocks) |
| Pricing | Free |
| Note | **Contains 0 wallet addresses today.** It is scanned every run so a future designation with an address is picked up automatically |
| Output | `intel_wallets` → `sources.sourceId: "un-consolidated"` |

### 3.6 Israel NBCTF crypto seizure orders (`il-nbctf`)

| | |
|---|---|
| Provider | Israel National Bureau for Counter Terror Financing, Ministry of Defense |
| Website | https://matal.mod.gov.il/ (moved from `nbctf.mod.gov.il`, which is now behind Incapsula bot protection) |
| Browse | `https://matal.mod.gov.il/חיפוש-סנקציות/#cryptocurrencyseizures` |
| How it's fetched | 1) `GET` the sanctions search page to receive the `.AspNetCore.Antiforgery…` cookie and the `__RequestVerificationToken` hidden field. 2) `POST https://matal.mod.gov.il/sanctions/export` with `SelectedTypes=seizureAndForfeitureOrderCryptocurrency`, `FileType=csv`, `Culture=en` and the token |
| Format | CSV, one row per order. The `Assets` column holds `Name: <value>` entries separated by `-------------` lines. Some values are wallet addresses and some are phone-number-keyed payment accounts; only valid TRON/EVM addresses are kept |
| Pricing | Free, Israeli government publication |
| Notes | Canceled orders (`Is Canceled = True`) are skipped. Each record keeps the order number (e.g. `FO 02/24`), order date and validity date |
| Output | `intel_wallets` → `sources.sourceId: "il-nbctf"` |

### 3.7 Tether USDT frozen addresses on TRON (`tether-usdt-tron`)

| | |
|---|---|
| Provider | TronScan (block explorer API) indexing Tether's on-chain blacklist on contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| Data URL | `https://apilist.tronscanapi.com/api/stableCoin/blackList?start=<offset>&limit=100` |
| Browse | https://tronscan.org/#/data/stableCoin/blackList |
| Docs | https://docs.tronscan.org/ |
| Format | JSON `{ total, data: [{ blackAddress, time, transHash, contractAddress, … }] }` |
| Pricing | Free. An API key is optional: set `TRONSCAN_API_KEY` (free from TronScan) for higher limits |
| Limits | `limit` must be between 20 and 100, so a full run is about 81 pages |
| Coverage | Complete current list, 2020-06 to the present (8,036 reported). The collector fails if it gets less than 95% of `total` |
| Not used | TronGrid's contract-events API also works, but without a key it allows **1 request/second** and suspends you for 5 s if exceeded. TronScan is simpler and complete |
| Output | `intel_wallets` → `sources.sourceId: "tether-usdt-tron"` |

### 3.8 Tether USDT frozen addresses on Ethereum (`tether-usdt-eth`)

| | |
|---|---|
| Provider | Ethereum mainnet via **Tenderly's free public RPC gateway**, reading Tether's USDT contract `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| RPC URLs | `https://gateway.tenderly.co/public/mainnet` (primary), `https://mainnet.gateway.tenderly.co` (fallback). Override with env `ETH_RPC_URL` |
| Docs | https://docs.tenderly.co/node · contract: https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7 |
| Method | **Incremental.** The first run, and a weekly safety rescan, read `eth_getLogs` from the deploy block (4,634,748) in 2M-block chunks; only Tenderly-class providers accept that. Every other run reads only the blocks since `notes.lastBlock` recorded by the last run, staying 12 blocks behind the head for reorg safety |
| Failover | Each block range is tried on providers in order: `ETH_RPC_URL` → Tenderly public (×2) → PublicNode (5k blocks) → MEV Blocker (5k) → dRPC (50). If the weekly full rescan can't run, the sync falls back to incremental. Tested 2026-10-28 with Tenderly blocked: PublicNode and MEV Blocker served the sync |
| Events | `AddedBlackList(address)` `0x42e16015…19dc`, `RemovedBlackList(address)` `0xd7e9ec6e…470c`, `DestroyedBlackFunds(address,uint256)` `0x61e6e66b…98c6` |
| Logic | An address is frozen if its **latest** Added/Removed event is `AddedBlackList`. `fundsDestroyed` is recorded in `details` |
| Pricing | Free, no key |
| Why Tenderly | Other free RPCs tested on 2026-10-28 limit `eth_getLogs` ranges: dRPC 10k blocks, Cloudflare 800, 1RPC 50, BlastAPI 10. PublicNode, Ankr and BlockPI require a key or payment |
| Last run | 4,824 events: 2,828 currently frozen, 343 unfrozen |
| Output | `intel_wallets` → `sources.sourceId: "tether-usdt-eth"` |

### 3.9 BSC: no Tether freeze list

USDT on BSC (`0x55d398326f99059fF775485246999027B3197955`) is **Binance-Peg BSC-USD, issued by Binance, not Tether**. Calling `isBlackListed()` on it reverts (verified 2026-10-28), so there is no freeze list to collect. BSC coverage comes only from sanctions lists, via the EVM mirroring described in section 4.

### 3.10 ScamSniffer (`scamsniffer`)

| | |
|---|---|
| Provider | ScamSniffer, a Web3 anti-scam vendor |
| Data URL | `https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/all.json` → `address` key |
| Docs | https://github.com/scamsniffer/scam-database |
| Format | JSON object (~10 MB); `address` is an array of ≈4.6k EVM addresses (a few malformed entries fail validation) |
| Pricing | Free |
| ⚠️ Freshness | **Address lists frozen since February 2024** (README). The repo still updates daily, but only `domains`. `all.json → address` is the last and largest copy (`address.json` has only ≈2.5k). Live addresses are only in ScamSniffer's paid real-time Blocklist API |
| ⚠️ License | **GPL-3.0.** Have legal review this before redistributing the data in a commercial product |
| Output | `intel_wallets` → `sources.sourceId: "scamsniffer"` |

### 3.11 MyEtherWallet darklist (`mew-darklist`)

| | |
|---|---|
| Data URL | `https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json` |
| Docs | https://github.com/MyEtherWallet/ethereum-lists |
| Format | JSON `[{ address, comment, date }]` |
| Pricing | Free, MIT |
| ⚠️ Freshness | **Frozen since 2020-11-18.** Kept as a static snapshot |
| Output | `intel_wallets` → `sources.sourceId: "mew-darklist"` |

### 3.12 eth-labels, Etherscan "Phish / Hack" (`eth-labels-phish-hack`)

| | |
|---|---|
| Data URL | `https://raw.githubusercontent.com/dawsbot/eth-labels/master/src/mainnet/phish-hack/all.json` |
| Docs | https://github.com/dawsbot/eth-labels |
| Format | JSON `[{ address, nameTag }]`. A mirror of Etherscan's public label cloud |
| Pricing | Free, MIT |
| ⚠️ Freshness | **Frozen since 2022-05-19** on the legacy `master` branch. The maintained `v1` export has no Ethereum phish-hack label (only other chains), so there is no replacement; kept as a static snapshot. `v1`'s exploit labels are read by `eth-labels-exploits` |
| Note | Category `HACK_EXPLOIT` (e.g. "Bancor Hacker") |
| Output | `intel_wallets` → `sources.sourceId: "eth-labels-phish-hack"` |

### 3.13 Forta labelled datasets (`forta-labelled`)

| | |
|---|---|
| Data URLs | `https://raw.githubusercontent.com/forta-network/labelled-datasets/main/labels/1/{phishing_scams,etherscan_malicious_labels,malicious_smart_contracts}.csv` |
| Docs | https://github.com/forta-network/labelled-datasets |
| Format | CSV. `malicious_smart_contracts.csv` also gives the deployer address, which is stored as `Deployer of <contract tag>` |
| Pricing | Free, MIT |
| ⚠️ Freshness | **Static snapshot, last updated 2023-01.** Useful history, but it receives no new data |
| Output | `intel_wallets` → `sources.sourceId: "forta-labelled"` |

### 3.14 FBI IC3 announcements (`fbi-ic3`)
| | |
|---|---|
| What | Addresses the FBI publishes in IC3 public service announcements. Currently PSA250226: 51 Ethereum addresses used to launder the Bybit hack (DPRK TraderTraitor / Lazarus) |
| Data URL | https://www.ic3.gov/PSA/2025/PSA250226 (list in `ANNOUNCEMENTS` in [fbiIc3.js](src/lib/collector/sources/fbiIc3.js); add new notices there) |
| Format | HTML page; every `0x…` / `T…` address on it is taken |
| Pricing / license | Free; US Government publication (public domain) |
| Mirroring | Yes, EVM addresses are also recorded on BSC (`evm-mirror`) |
| Output | `intel_wallets` → `sources.sourceId: "fbi-ic3"`, category `HACK_EXPLOIT` |

### 3.15 Other stablecoin issuer freezes (`circle-usdc-eurc-eth`, `paxos-usdp-pyusd-eth`, `tusd-eth`)
| | |
|---|---|
| What | Addresses frozen on-chain by stablecoin issuers other than Tether, rebuilt from contract events exactly like `tether-usdt-eth` (same RPC providers, full history then incremental, weekly rescan) |
| Contracts / events | **Circle:** USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, EURC `0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c` — `Blacklisted(address)` / `UnBlacklisted(address)`. **Paxos:** USDP `0x8E870D67F660D95d5be530380D0eC0bd388289E1`, PYUSD `0x6c3ea9036406852006290770BEdFcAbA0e23A0e8` — `AddressFrozen` (original contracts) and `FreezeAddress` (upgraded contracts: PYUSD from Jun 2024, USDP from Dec 2024) / `AddressUnfrozen` (and `UnfreezeAddress`, not yet seen) / `FrozenAddressWiped`. Changing a source's contracts or events makes its next run rescan the full history (`notes.filterKey`). **TrueUSD:** `0x0000000000085d4780B73119b644AE5ecd22b376` — `Blacklisted(address,bool)` (true = freeze) |
| Format | `eth_getLogs`; the affected address is topic 1. Each record's `details.freezes` holds the freeze tx / block per token |
| Pricing / license | Free, public on-chain data |
| Notes | Issuers' own token contracts (frozen so tokens can't get stuck there) are skipped. Unfreezes remove the address |
| Output | `intel_wallets` → category `ISSUER_FREEZE`. Screening names the issuer (e.g. "Circle Internet Financial Frozen Wallet") |

### 3.16 Court-judgment fraud addresses (`judicial-fraud-labels`)
| | |
|---|---|
| What | Wallets named in criminal judgments on crypto fraud and money laundering: roles `fraud platform`, `pseudo broker` (laundering), `illegal broker` |
| Data | Dataset API https://data.mendeley.com/public-api/datasets/62dmsngtfb → file `judicial_ground_truth_address_labels_public*.csv` (latest version) |
| Pricing / license | Free, **CC BY 4.0**. Attribution: Tsai, M. L., "Judicially Grounded Virtual Asset Address Labels and TRON TRC20-USDT Behavioral Analysis Dataset", Mendeley Data, doi:10.17632/62dmsngtfb. Changes made: victim and non-TRON rows removed |
| Filtering | `victim` rows are dropped (they are not bad actors). Only TRON rows are kept: the public release masks some addresses, and TRON's base58 checksum rejects a masked one, while EVM rows can't be checked and don't name their chain |
| Freshness | Static research dataset (v3, Aug 2026) |
| Output | `intel_wallets` → category `SCAM_PHISHING`, tier 3 |

### 3.17 eth-labels exploit labels (`eth-labels-exploits`)
| | |
|---|---|
| What | From eth-labels' maintained CSV export: BSC (chainId 56) `heist` and `scam` labels, and Ethereum `*-exploit` labels (Bybit, WazirX, BingX, Filament, …). The `blocked` label is ignored (null/placeholder addresses) |
| Data URL | `https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/csv/accounts.csv` |
| Pricing / license | Free, MIT |
| Output | `intel_wallets` → `HACK_EXPLOIT` (heist, exploit) / `SCAM_PHISHING` (scam) |

### 3.18 DeFiHackLabs (`defihacklabs`)
| | |
|---|---|
| What | Attacker wallets and attack contracts from ~900 reproduced DeFi exploits. Only Ethereum and BSC incidents are kept (chain from the explorer links in the header, or the PoC's fork) |
| Data | File list via `https://api.github.com/repos/SunWeb3Sec/DeFiHackLabs/git/trees/main?recursive=1` (one unauthenticated GitHub API call per run), then each `src/test/<YYYY-MM>/*.sol` from raw.githubusercontent.com |
| Format | Header comments in the first 60 lines: `// Attacker : 0x…` (also `Attacker1`, `Attacker EOA`, `Exploiter`, `Hacker`), `// Attack Contract : 0x…` (also `Attack ctrt`, `Exploit contract`), `// Attack Tx : https://etherscan.io/…`. Lines about the victim, vulnerable contract, profit or tx are ignored, and 64-hex tx hashes are never read as addresses. Chain from explorer links, else from `createSelectFork(...)` (`mainnet`, `bsc`, `*_ARCHIVE`, env/RPC names) |
| Pricing / license | Free, Apache-2.0 (repository) |
| Filtering | Incidents mentioning a whitehat, and known whitehat rescue bots (e.g. c0ffeebabe.eth), are skipped |
| Output | `intel_wallets` → category `HACK_EXPLOIT`, `listedAt` = incident month, `details.lost` / `details.attackTx` |

### 3.19 Hugging Face Ethereum fraud dataset (`hf-eth-fraud`)
| | |
|---|---|
| What | A research aggregate of public Ethereum scam lists (MEW, ScamSniffer, Forta, CryptoScamDB, Etherscan labels via brianleect, Kaggle, XBlock, BlockSec's PTXPhish and SIGMETRICS'25 phishing contracts). About 37k of the rows are phishing **contracts**, not wallets |
| Data URL | `https://huggingface.co/datasets/fesevu/ethereum_fraud_dataset_by_activity/resolve/main/addr_labels_balanced.csv.zst` (3.8 MB). It holds every `is_scam=1` row of the 100 MB `addr_labels_big.csv.zst` (54,653 addresses), so the small file is used |
| Docs | https://huggingface.co/datasets/fesevu/ethereum_fraud_dataset_by_activity |
| Format | zstd-compressed CSV: `address, is_scam, description, activity_start_ts, activity_end_ts, is_contract`. Decompressed with `fzstd` (Node 20 has no built-in zstd) |
| Pricing / license | Free, CC BY 4.0 (credit the dataset). ⚠️ Some upstream lists it merges have no licence of their own |
| Filtering | Only `is_scam=1`. Dropped as not-scammers: `Parity Bug` (frozen-wallet victims), Etherscan `take-action` hack alerts (≈3.1k users with approvals open to a hacked contract, e.g. Multichain) and `Spam Token` airdrops |
| Freshness | Static, last modified 2025-08 |
| Output | `intel_wallets` → `HACK_EXPLOIT` when the description says exploit / heist / hack, else `SCAM_PHISHING`; `entity` = description + `(wallet)` / `(contract)` |

### 3.20 Poison-Hunter address-poisoning attackers (`poison-hunter`)
| | |
|---|---|
| What | Ethereum address-poisoning look-alike addresses from the ACM CCS'24 paper "Characterizing Ethereum Address Poisoning Attack" (Guan & Li) |
| Data URLs | `https://raw.githubusercontent.com/DS2L/Poison-Hunter/main/phishing_address_groundtruth.txt` (5,890 addresses labelled by both Etherscan and Forta, one per line) and `…/phishing_transfers_sample.csv` (only the `attacker` column: 129 more) |
| Not used | `benign_addresses_on_etherscan.txt` (the paper's safe set), `phishing_address_we_detected_TP.txt` (subset of the ground truth), and the sample's `victim` / token columns |
| Docs | https://github.com/DS2L/Poison-Hunter |
| Pricing / license | Free to download. ⚠️ **No licence file**, so all rights are reserved by default; ask the authors before commercial use. The full detected set is "available on request" |
| Freshness | Static, last commit 2025-04-11 |
| Output | `intel_wallets` → `SCAM_PHISHING`, confidence 70 |

### 3.21 Drainer-as-a-Service (`drainer-daas`)
| | |
|---|---|
| What | Wallets and contracts behind wallet-drainer kits, from the IMC'25 paper "Unmasking the Shadow Economy: A Deep Dive into Drainer-as-a-Service Phishing on Ethereum" (He et al., BlockSec). Identified from the kits' on-chain profit-sharing payments |
| Data URLs | `https://raw.githubusercontent.com/blocksecteam/DaaS_dataset/main/{operator_accounts,affiliate_accounts,profit_sharing_contracts}.log` — one address per line: 56 operators, 6,087 affiliates (the phishers renting the kit), 1,910 profit-sharing contracts |
| Not used | `profit_sharing_transactions.log` (5.8 MB of transaction records — the evidence, not addresses) |
| Docs | https://github.com/blocksecteam/DaaS_dataset |
| Pricing / license | Free to download. ⚠️ **No licence file**, so all rights are reserved by default; ask the authors before commercial use |
| Freshness | Static, last commit 2025-11-28 |
| Output | `intel_wallets` → `SCAM_PHISHING`, confidence 70; `entity` says operator / affiliate / profit-sharing contract |

### 3.22 Lazarus / DPRK research notes (`lazarus-tayvano`)
| | |
|---|---|
| What | Theft, laundering, Tornado Cash, dusting and IT-worker wallets from North Korean (Lazarus / BlueNoroff / IT-worker) crypto heists, kept by researcher Tayvano. One markdown write-up per incident; each address line carries a free-text role (`- 0x… - Direct Theft`) |
| Data | File list via `https://api.github.com/repos/tayvano/lazarus-bluenoroff-research/git/trees/main?recursive=1` (one unauthenticated GitHub API call per run), then each `hacks-and-thefts/*.md` and `dprk-it-workers/*.md` from `https://raw.githubusercontent.com/tayvano/lazarus-bluenoroff-research/main/…` (≈300 files, ≈4 MB) |
| Not used | `more-hacks-and-thefts/` (mixes in incidents the author marks "Not DPRK" and non-crime tracking such as the PulseX / Richard Heart file), `pdfs/`, `images/`, `malicious-shit/`, the Bitcoin-only CSVs, and the `.txt` Telegram dumps in `dprk-it-workers/` |
| Filtering | Skipped sections: victims, compromised / impacted / at-risk wallets, Atomic Wallet's "Theft Addresses + Amt Stolen" (the victim list), "Receives From" counterparties, whitehat and "not DPRK" sections. Skipped roles: victim, "interacted with" / "approved" a drainer, exchange and swap-service deposits (Binance, OKX, KuCoin, HTX, ChangeNOW, FixedFloat, THORSwap, SideShift, …), multisig / hot / cold wallets, token contracts, protocols and routers |
| Chain | `T…` → TRON; `0x…` → BSC when the line says BSC/BNB, else Ethereum (the notes often don't say which EVM chain) |
| Pricing / license | Free, **CC0-1.0** (no restrictions, commercial use allowed) |
| Freshness | Actively updated (commits weekly or more; last 2026-10-30) |
| Output | `intel_wallets` → `HACK_EXPLOIT`, tier 4, confidence 70; `entity` = `Lazarus / DPRK — <incident> (<role>)`, `programs` = incident, `listedAt` = the write-up's `Date::` line, reference = the write-up on GitHub |

---

## 4. Data model

### Sync run (MongoDB `intel_sync_runs`)

```jsonc
{
  "_id": ObjectId("…"),
  "status": "running" | "done" | "failed",
  "startedAt": "ISO time", "finishedAt": "ISO time", "durationMs": 101000,
  "only": null,                       // or the source ids of a partial run
  "error": "…",                       // only when the whole run failed
  "totals": { "entries", "active", "delisted", "added", "newlyDelisted", "relisted", "written" },
  "sources": [ { "id", "status": "ok" | "stale" | "failed", "records", "fetchedAt", "sourceDate",
                 "durationMs", "notes", "lastError", "lastAttemptAt", "shrinkBlocked" } ],
  "warnings": [ { "sourceId", "kind", "message" } ],
  "crossCheck": { "ofac": { "onlyInOfacDirect": [], "onlyIn0xB10C": [] } }
}
```

### Sync error (MongoDB `intel_sync_errors`)

```jsonc
{
  "runId": ObjectId("…"), "runStartedAt": "ISO time",
  "failedAt": "ISO time",
  "scope": "source" | "run",          // "run" = the whole run crashed (sourceId is null)
  "sourceId": "tether-usdt-tron", "sourceName": "Tether USDT (TRC-20) frozen addresses", "authority": "…",
  "kind": "http" | "network" | "timeout" | "rpc" | "format" | "shrink-blocked" | "other",
  "name": "TypeError",
  "message": "fetch failed",
  "cause": "ENOTFOUND: getaddrinfo ENOTFOUND apilist.tronscanapi.com",   // the real reason, if any
  "httpStatus": 503 | null,
  "stack": "first lines of the stack trace",
  "durationMs": 1234,
  "outcome": "kept previous data" | "no data (never collected)" | "run failed, nothing written",
  "recordsKept": 8070,                // listings still used for screening
  "shrink": { "previous": 599, "fresh": 12 } | null
}
```

A failure that a retry recovers from is not logged; only a source that ends the run failed or stale is.

### Wallet change (MongoDB `intel_run_wallets`)

```jsonc
{
  "runId": ObjectId("…"), "runAt": "ISO time",
  "change": "added" | "delisted" | "relisted" | "source-added" | "source-removed",
  "key": "TRON:TXyz…", "chain": "TRON", "address": "TXyz…",
  "status": "active", "category": "ISSUER_FREEZE", "tier": 2, "confidence": 90,
  "entities": ["Tether-frozen address"], "firstSeen": "ISO time",
  "sources": [ { "sourceId", "authority", "jurisdiction", "category", "basis",
                 "entity", "programs", "reference", "listedAt" } ]   // the listings that were added / removed
}
```

### Merged entry (MongoDB `intel_wallets`)

```jsonc
{
  "key": "ETHEREUM:0x7ff9…",
  "chain": "ETHEREUM",
  "address": "0x7ff9…",
  "category": "SANCTIONS",            // most severe of `categories`
  "categories": ["SANCTIONS", "ISSUER_FREEZE"],
  "tier": 1,                          // best (lowest) tier across sources
  "confidence": 100,                  // highest confidence across sources
  "entities": ["GARANTEX EUROPE OU", "…"],
  "sources": [ { "sourceId", "authority", "jurisdiction", "tier", "category", "basis", "confidence",
                 "entity", "programs", "reference", "listedAt", "details",
                 "status",            // "active" | "removed" (the publisher no longer lists it)
                 "removedAt" } ],     // ISO time of the run that first saw it gone, else null
  "status":     "active",             // "active" | "delisted" (no source lists it any more)
  "firstSeen":  "ISO time (kept across runs)",
  "delistedAt": null,                 // ISO time it became delisted
  "relistedAt": null,                 // ISO time it was listed again after being delisted
  "updatedAt":  "ISO time of the last run that changed this wallet",
  "search":     "lowercased address, entities, programs, reference ids (directory search; not returned by the API)"
}
```

The directory lists wallets **newest first** (`firstSeen` descending); wallets found in the same run are ordered most severe first (tier, then confidence).

### Wallets are never deleted
When a publisher drops an address, the next sync keeps it: that source's record gets `status: "removed"` + `removedAt`. If no source lists the address any more, the whole entry becomes `status: "delisted"` + `delistedAt`, and keeps the category / entity / programs it was listed under. If it is listed again, it returns to `active` with `relistedAt` set.

- **Screening uses only active sources.** `lookupAddress()` drops removed source records and returns nothing for delisted addresses; `lookupAddressHistory()` returns the full entry.
- **Directory:** a *Status* filter (All / Active / Delisted), a *Delisted* badge, removed sources struck through, and a *Removed* date column in the details.
- **Changelog:** each run records `added`, `delisted` and `relisted` keys.
- The shrink guard (§2) still applies first, so a broken parser can't mark hundreds of wallets delisted by mistake.

### Rules applied during normalization
- **Validation:** TRON addresses must pass the base58check checksum, and EVM addresses must be `0x` plus 40 hex characters. Anything else (BTC, `bnb1…`, phone numbers, typos) is rejected and counted in `stats.rejected`.
- **EVM mirroring (sanctions tiers only):** the same private key controls an EVM address on every EVM chain, so a sanctioned address is recorded on **both** Ethereum and BSC. The chain the publisher named is `basis: "listed"`. The other is `basis: "evm-mirror"`, with **confidence −10**. If no chain is named (e.g. `USDT: 0x…`), Ethereum counts as listed.
- **No mirroring** for Tether freezes, which apply to one specific contract, or for OSINT lists, which are Ethereum-specific.
- **Failure handling:** if a source fails, times out, or shrinks past its limit, its current listings are kept and it is marked `stale`, so one outage or parser break never removes addresses (see *Consistency guarantees* in §2).

---

## 5. Environment variables

`MONGODB_URI` is required; the rest are optional.

| Variable | Used by | Effect |
|---|---|---|
| `MONGODB_URI` | Collector, directory, screening | MongoDB Atlas connection string (`mongodb+srv://…`). **Required** |
| `MONGODB_DB` | Collector, directory, screening | Database name (default `dextrlabs_kyt`) |
| `ETH_RPC_URL` | `tether-usdt-eth` | Your own Ethereum RPC URL (key inside the URL, e.g. a Tenderly Node RPC from https://dashboard.tenderly.co), tried before the free public nodes |
| `ETH_RPC_MAX_RANGE` | `tether-usdt-eth` | Largest `eth_getLogs` block range your `ETH_RPC_URL` accepts (default 2,000,000). Lower it for providers like Alchemy or Infura |
| `TRONSCAN_API_KEY` | `tether-usdt-tron` | Sent as `TRON-PRO-API-KEY` for higher TronScan limits. **TronScan keys are separate from TronGrid keys** |
| `TRONGRID_API_KEY` | Screening: live TRON freeze check ([trongridClient.js](src/lib/tron/trongridClient.js)) | Sent as `TRON-PRO-API-KEY`, so calls count against your TronGrid account and show in its dashboard. Without it calls are anonymous and rate-limited |

---

## 6. Sources considered but not used

| Source | Why not | Link |
|---|---|---|
| **OpenSanctions** | Bulk data is free for **non-commercial use only** (CC BY-NC), and commercial use needs a paid license. We pull the same government lists directly instead | https://www.opensanctions.org/licensing/ |
| Etherscan / BscScan API v2 | Needs an API key. The free tier is reported to no longer cover BSC; verify this before relying on it | https://docs.etherscan.io/ |
| Chainabuse | Needs an API key (free tier, requires approval). Planned as Tier 5 | https://docs.chainabuse.com/ |
| ransomwhe.re | Bitcoin-only, so out of scope for USDT on TRON/ETH/BSC | https://ransomwhe.re/ |
| CryptoScamDB API | Down (HTTP 502) as of 2026-10-28 | https://cryptoscamdb.org/ |
| SlowMist Hacked | No structured address feed; would need manual extraction | https://hacked.slowmist.io/ |
| Commercial (Chainalysis, TRM Labs, Elliptic) | Paid enterprise contracts | — |
| BSC stablecoin freezes (USD1, FDUSD) | The contracts do emit `Freeze(address,address)` / `Unfreeze(address,address)`, but free BSC RPCs serve at most 5,000 blocks per `eth_getLogs` call (BSC is ~130M blocks), so reading the history needs a paid RPC or BscScan API key | — |
| Chainalysis sanctions oracle (`0x40C5…fb`) | Deprecated (last update 2026-03); a subset of OFAC, which we already parse | — |
| TronScan security API / GoPlus address security | Per-address lookups only (no bulk list); suited to live screening, not to the database. TronScan's flags did not mark sanctioned or seized TRON wallets in a 2026-10-29 test | https://apilist.tronscanapi.com · https://gopluslabs.io |
| Chainabuse | Free key is 10 calls/month; partner access by request. Largest source of TRON scam reports | https://docs.chainabuse.com/ |
| DeFiLlama hacks | Incident list without addresses | https://api.llama.fi/hacks |
| **Blockscout metadata tags** (on hold) | ≈ 71.6k ETH + 2.3k BSC phish/hack, poisoning, ChainPatrol tags; free, keyless, but no published terms for the tag data and the labels come from third parties (Etherscan-style `Fake_Phishing`, Match Systems). Paused 2026-10-30 until the terms are confirmed. A full crawl is ≈ 1,700 requests (50 per page, sorted by address, no "since" filter) | https://metadata.services.blockscout.com/api/v1/addresses?slug=phish--hack&tagType=generic&chainId=1 |
| CMU address-poisoning dataset (USENIX Sec '25) | ≈ 6.5M ETH look-alike addresses, but CC BY-NC-ND (non-commercial) | https://kilthub.cmu.edu/articles/dataset/Blockchain_Address_Poisoning_Companion_Dataset_/29212703/1 |

---

## 7. Adding a new source

1. Create `src/lib/collector/sources/<name>.js` that exports an object such as:
   ```js
   export const mySource = {
     id: "my-source", name: "…", authority: "…", jurisdiction: "US",
     tier: 1, confidence: 100, category: "SANCTIONS",
     license: "…", homepage: "https://…",
     mirror: true,                       // mirror EVM addresses to ETH+BSC?
     timeoutMs: 4 * 60 * 1000,           // optional, default 4 min
     maxShrink: 0.1,                     // optional, overrides the tier's shrink limit
     async collect({ previous, progress }) {
       // Throw if the download doesn't look like the expected format — never return [] for that.
       return { items: [{ address, statedChain, entity, programs, reference, listedAt }], sourceDate, notes };
     },
   };
   ```
2. Register it in [src/lib/collector/sources/index.js](src/lib/collector/sources/index.js).
3. Add a label and colour for it in `SOURCE_LABELS` / `SOURCE_BADGES` in [SanctionedWalletsDirectory.jsx](src/components/SanctionedWalletsDirectory.jsx).
4. Run `npm run collect:intel -- --only=my-source` and check its wallets in `intel_wallets` (`sources.sourceId: "my-source"`) and its status in the newest `intel_sync_runs` document.
5. Add a section for it to this document.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `il-nbctf` fails with "anti-forgery token not found" | The NBCTF site changed its page layout or URL | Open the site in a browser, find the crypto export form, and update `SEARCH_PAGE` / form fields in `ilNbctf.js` |
| `tether-usdt-eth` fails with a range or limit error on every RPC | Tenderly changed its free limits | Set `ETH_RPC_URL` to another archive RPC, or lower `CHUNK` in `tetherEth.js` |
| `tether-usdt-tron` says "blacklist incomplete after 3 attempts" | TronScan rate-limited, or the list kept changing mid-read | Re-run that source, or set `TRONSCAN_API_KEY` |
| A warning says "record count fell from X to Y" | The shrink guard blocked a big drop | Compare the counts in the warning with the publisher. If the delisting is real, click **Accept new data** (or `--accept-shrink=<id>`); if not, the parser needs fixing |
| "another collection is already running" | A sync is in progress (UI or CLI) | Wait for it; a lock from a crashed run is taken over automatically after the process is gone |
| `crossCheck.ofac` is not empty | The OFAC XML parser and 0xB10C disagree | Check the listed addresses in the SDN search. Either OFAC added a new asset type (update `RELEVANT_ASSETS`) or the XML structure changed |
| A source shows `stale` in the UI (amber dot) | Its last fetch failed, so the previous data is in use | See the newest document for that source in `intel_sync_errors` (message, cause, stack) |
| Directory and screening fail with "MONGODB_URI is not set" or a connection error | No connection string, or Atlas is blocking this machine | Set `MONGODB_URI` in `.env`; in Atlas → Network Access, allow this machine's IP |
