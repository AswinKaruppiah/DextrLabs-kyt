# Data Sources — Threat Intelligence Collector

This document lists every external service the KYT collector pulls data from: what each one provides, what it costs, where its documentation is, and where the downloaded data ends up on disk.

> **Scope:** USDT risk addresses on **TRON, Ethereum and BSC** only.
> **Cost:** every source below is **free**. No paid API, subscription or API key is required.
> **Last verified:** 2026-10-28. Counts below are from that run.

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
| 9 | `scamsniffer` | ScamSniffer (GitHub) | 4 | Drainer / phishing addresses | JSON | None | Free | 2,530 |
| 10 | `mew-darklist` | MyEtherWallet (GitHub) | 4 | Community darklist | JSON | None | Free | 652 |
| 11 | `eth-labels-phish-hack` | dawsbot/eth-labels (GitHub) | 4 | Etherscan "Phish / Hack" labels | JSON | None | Free | 5,594 |
| 12 | `forta-labelled` | Forta Network (GitHub) | 4 | Phishing EOAs + malicious contracts and their deployers | CSV | None | Free | 7,891 |

**Tiers**
- **Tier 1:** government sanctions and seizure orders. Legally binding, so a match blocks.
- **Tier 2:** stablecoin issuer freezes. The issuer has acted on the address, so it is high risk.
- **Tier 4:** OSINT, community and vendor labels. These raise the risk score but must never block on their own.
- Tier 3 is reserved for curated sanctioned-entity data, and Tier 5 for community reports such as Chainabuse. Neither is implemented yet.

**Totals (merged, de-duplicated per chain):** 21,635 entries: 8,080 TRON, 13,416 Ethereum and 139 BSC.

---

## 2. Where the data lives

```
data/intel/
├── addresses.json        # MERGED database — one entry per chain:address, with every source that flagged it
├── manifest.json         # Status of the last run: per-source ok/stale/failed, counts, errors, OFAC cross-check
├── changelog.jsonl       # One line per run: added / delisted / re-listed address keys (use for re-screening)
└── sources/
    ├── ofac-sdn.json             # One snapshot per source: metadata + stats + normalized records
    ├── ofac-0xb10c.json
    ├── eu-fsf.json
    ├── uk-sanctions-list.json
    ├── un-consolidated.json
    ├── il-nbctf.json
    ├── tether-usdt-tron.json
    ├── tether-usdt-eth.json
    ├── scamsniffer.json
    ├── mew-darklist.json
    ├── eth-labels-phish-hack.json
    └── forta-labelled.json
```

Raw downloads (XML, CSV, HTML) are **not** stored, only the normalized records. To inspect the raw data, open the source URL from section 3 in a browser.

### Code

| Path | Purpose |
|---|---|
| [src/lib/collector/sources/](src/lib/collector/sources/) | One module per source (fetch and parse) |
| [src/lib/collector/sources/index.js](src/lib/collector/sources/index.js) | Registry of all sources. Add new sources here |
| [src/lib/collector/run.js](src/lib/collector/run.js) | Runs sources, validates addresses, merges, writes files |
| [src/lib/collector/store.js](src/lib/collector/store.js) | Read and query layer: `queryIntel()` for the directory API, `lookupAddress(chain, address)` for screening |
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
- **One run at a time.** A lock file (`data/intel/.collect.lock`) is shared by the web app and the CLI. A second click joins the running job; a second CLI run exits with "another collection is already running". A lock left by a crashed process is taken over.
- **Time limit per source** (default 4 min; TronScan 8 min, Tether ETH 6 min). A source that runs over is cancelled, including its in-flight downloads, and keeps its last good snapshot. The other sources still finish and the database is rebuilt.
- **Shrink guard.** Each fresh result is compared with the last good snapshot. If the record count drops by more than 10% (sanctions), 5% (Tether freezes) or 30% (OSINT), the new result is parked in `sources/<id>.rejected.json`, the previous data is kept, and a warning with an **Accept new data** button appears in the UI. Accept it only after checking the publisher really delisted the addresses (e.g. OFAC's Tornado Cash delisting).
- **Format checks.** Every parser throws if the publisher's file no longer has the expected structure (missing records, renamed columns), so a format change shows up as `stale` with a reason instead of an empty source.
- **TronScan completeness.** A pass must read every row TronScan reports; if the list changes mid-read the pass is retried (up to 3 times). Never accepted short.
- **Ethereum empty results.** Every empty `eth_getLogs` chunk is re-asked of a second node; if that one finds freeze events, its answer is used (`notes.emptyChecks`). Logs from any other contract are rejected.
- **Warnings** (stale/failed sources, blocked drops, OFAC cross-check mismatch) are written to `manifest.json` → `warnings` and shown above the source list.

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
| Output | `data/intel/sources/ofac-sdn.json` |
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
| Why it exists | An independent second parse of OFAC. `manifest.json → crossCheck.ofac` lists any address only one of the two parses found. It should be empty; the 2026-10-28 run had 0 differences. It also serves as a fallback if treasury.gov is down |
| Output | `data/intel/sources/ofac-0xb10c.json` |

### 3.3 EU Consolidated Financial Sanctions List (`eu-fsf`)

| | |
|---|---|
| Provider | European Commission (FPI), Financial Sanctions Files |
| Data URL | `https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw` |
| Docs | https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions |
| Format | XML. **The EU has no wallet field.** Addresses appear in free-text `<remark>` elements, e.g. `Known Garantex blockchain wallet addresses: ETH: 0x… BSC: 0x… TRX: T…`. The chain is taken from the nearest label before each address |
| Pricing | Free, EU public data (reuse permitted with attribution) |
| Output | `data/intel/sources/eu-fsf.json` |

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
| Output | `data/intel/sources/uk-sanctions-list.json` |

### 3.5 UN Security Council Consolidated List (`un-consolidated`)

| | |
|---|---|
| Provider | United Nations Security Council |
| Data URL | `https://scsanctions.un.org/resources/xml/en/consolidated.xml` |
| Docs | https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list |
| Format | XML (`<INDIVIDUAL>` / `<ENTITY>` blocks) |
| Pricing | Free |
| Note | **Contains 0 wallet addresses today.** It is scanned every run so a future designation with an address is picked up automatically |
| Output | `data/intel/sources/un-consolidated.json` |

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
| Output | `data/intel/sources/il-nbctf.json` |

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
| Output | `data/intel/sources/tether-usdt-tron.json` |

### 3.8 Tether USDT frozen addresses on Ethereum (`tether-usdt-eth`)

| | |
|---|---|
| Provider | Ethereum mainnet via **Tenderly's free public RPC gateway**, reading Tether's USDT contract `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| RPC URLs | `https://gateway.tenderly.co/public/mainnet` (primary), `https://mainnet.gateway.tenderly.co` (fallback). Override with env `ETH_RPC_URL` |
| Docs | https://docs.tenderly.co/node · contract: https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7 |
| Method | **Incremental.** The first run, and a weekly safety rescan, read `eth_getLogs` from the deploy block (4,634,748) in 2M-block chunks; only Tenderly-class providers accept that. Every other run reads only the blocks since `notes.lastBlock` in the snapshot, staying 12 blocks behind the head for reorg safety |
| Failover | Each block range is tried on providers in order: `ETH_RPC_URL` → Tenderly public (×2) → PublicNode (5k blocks) → MEV Blocker (5k) → dRPC (50). If the weekly full rescan can't run, the sync falls back to incremental. Tested 2026-10-28 with Tenderly blocked: PublicNode and MEV Blocker served the sync |
| Events | `AddedBlackList(address)` `0x42e16015…19dc`, `RemovedBlackList(address)` `0xd7e9ec6e…470c`, `DestroyedBlackFunds(address,uint256)` `0x61e6e66b…98c6` |
| Logic | An address is frozen if its **latest** Added/Removed event is `AddedBlackList`. `fundsDestroyed` is recorded in `details` |
| Pricing | Free, no key |
| Why Tenderly | Other free RPCs tested on 2026-10-28 limit `eth_getLogs` ranges: dRPC 10k blocks, Cloudflare 800, 1RPC 50, BlastAPI 10. PublicNode, Ankr and BlockPI require a key or payment |
| Last run | 4,824 events: 2,828 currently frozen, 343 unfrozen |
| Output | `data/intel/sources/tether-usdt-eth.json` |

### 3.9 BSC: no Tether freeze list

USDT on BSC (`0x55d398326f99059fF775485246999027B3197955`) is **Binance-Peg BSC-USD, issued by Binance, not Tether**. Calling `isBlackListed()` on it reverts (verified 2026-10-28), so there is no freeze list to collect. BSC coverage comes only from sanctions lists, via the EVM mirroring described in section 4.

### 3.10 ScamSniffer (`scamsniffer`)

| | |
|---|---|
| Provider | ScamSniffer, a Web3 anti-scam vendor |
| Data URL | `https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json` |
| Docs | https://github.com/scamsniffer/scam-database |
| Format | JSON array of EVM addresses |
| Pricing | Free |
| ⚠️ License | **GPL-3.0.** Have legal review this before redistributing the data in a commercial product |
| Output | `data/intel/sources/scamsniffer.json` |

### 3.11 MyEtherWallet darklist (`mew-darklist`)

| | |
|---|---|
| Data URL | `https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json` |
| Docs | https://github.com/MyEtherWallet/ethereum-lists |
| Format | JSON `[{ address, comment, date }]` |
| Pricing | Free, MIT |
| Output | `data/intel/sources/mew-darklist.json` |

### 3.12 eth-labels, Etherscan "Phish / Hack" (`eth-labels-phish-hack`)

| | |
|---|---|
| Data URL | `https://raw.githubusercontent.com/dawsbot/eth-labels/master/src/mainnet/phish-hack/all.json` |
| Docs | https://github.com/dawsbot/eth-labels |
| Format | JSON `[{ address, nameTag }]`. A mirror of Etherscan's public label cloud |
| Pricing | Free, MIT |
| Note | Category `HACK_EXPLOIT` (e.g. "Bancor Hacker") |
| Output | `data/intel/sources/eth-labels-phish-hack.json` |

### 3.13 Forta labelled datasets (`forta-labelled`)

| | |
|---|---|
| Data URLs | `https://raw.githubusercontent.com/forta-network/labelled-datasets/main/labels/1/{phishing_scams,etherscan_malicious_labels,malicious_smart_contracts}.csv` |
| Docs | https://github.com/forta-network/labelled-datasets |
| Format | CSV. `malicious_smart_contracts.csv` also gives the deployer address, which is stored as `Deployer of <contract tag>` |
| Pricing | Free, MIT |
| ⚠️ Freshness | **Static snapshot, last updated 2023-01.** Useful history, but it receives no new data |
| Output | `data/intel/sources/forta-labelled.json` |

---

## 4. Data model

### Per-source snapshot (`data/intel/sources/<id>.json`)

```jsonc
{
  "source":   { "id", "name", "authority", "jurisdiction", "tier", "confidence", "category", "license", "homepage" },
  "status":   "ok" | "stale" | "failed",
  "fetchedAt": "ISO time", "sourceDate": "publisher's own date if any", "durationMs": 1234,
  "stats":    { "items", "records", "rejected", "rejectedSample", "byChain", "byBasis" },
  "notes":    { /* source-specific, e.g. NBCTF canceledOrders */ },
  "records": [
    {
      "key": "TRON:TXyz…",          // chain:address (EVM lowercased)
      "chain": "TRON" | "ETHEREUM" | "BSC",
      "address": "…",
      "basis": "listed" | "evm-mirror",
      "category": "SANCTIONS" | "ISSUER_FREEZE" | "HACK_EXPLOIT" | "SCAM_PHISHING",
      "entity": "GARANTEX EUROPE OU",
      "programs": ["CYBER4", "RUSSIA-EO14024"],
      "reference": { "id": "SDN-36025", "url": "https://…" },
      "listedAt": "2022-05-04" | null,
      "details": { /* e.g. validUntil, frozenAtBlock, fundsDestroyed */ }
    }
  ]
}
```

### Merged entry (`data/intel/addresses.json → entries[]`)

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
  "lastSeen":   "ISO time of the last run that saw it listed",
  "delistedAt": null,                 // ISO time it became delisted
  "relistedAt": null                  // ISO time it was listed again after being delisted
}
```

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
- **Failure handling:** if a source fails, times out, or shrinks past its limit, its previous snapshot is kept and marked `stale`, so one outage or parser break never removes addresses (see *Consistency guarantees* in §2).

---

## 5. Environment variables (all optional)

| Variable | Used by | Effect |
|---|---|---|
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
4. Run `npm run collect:intel -- --only=my-source` and check `data/intel/sources/my-source.json`.
5. Add a section for it to this document.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `il-nbctf` fails with "anti-forgery token not found" | The NBCTF site changed its page layout or URL | Open the site in a browser, find the crypto export form, and update `SEARCH_PAGE` / form fields in `ilNbctf.js` |
| `tether-usdt-eth` fails with a range or limit error on every RPC | Tenderly changed its free limits | Set `ETH_RPC_URL` to another archive RPC, or lower `CHUNK` in `tetherEth.js` |
| `tether-usdt-tron` says "blacklist incomplete after 3 attempts" | TronScan rate-limited, or the list kept changing mid-read | Re-run that source, or set `TRONSCAN_API_KEY` |
| A warning says "record count fell from X to Y" | The shrink guard blocked a big drop | Compare `sources/<id>.rejected.json` with the publisher. If the delisting is real, click **Accept new data** (or `--accept-shrink=<id>`); if not, the parser needs fixing |
| "another collection is already running" | A sync is in progress (UI or CLI) | Wait for it; a lock from a crashed run is taken over automatically after the process is gone |
| `crossCheck.ofac` is not empty | The OFAC XML parser and 0xB10C disagree | Check the listed addresses in the SDN search. Either OFAC added a new asset type (update `RELEVANT_ASSETS`) or the XML structure changed |
| A source shows `stale` in the UI (amber dot) | Its last fetch failed, so the previous data is in use | See `lastError` in `data/intel/manifest.json` |
