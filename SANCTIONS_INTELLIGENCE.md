# Sanctions Intelligence & Data Feeds Architecture

This document outlines the exact data sources, government feeds, endpoints, and architectural principles used by **DextrLabs-KYT** to ingest, deduplicate, and screen cryptocurrency addresses for USDT compliance across **TRON**, **Ethereum**, and **BNB Smart Chain (BSC)**.

---

## 1. Core Architectural Principles

1. **Zero Hardcoded Mock Lists**: All sanctioned entities are dynamically downloaded from primary regulatory authorities and cached locally in `data/sanctions-cache.json`.
2. **Multi-Source Deduplication**: If an address is designated by more than one authority (e.g., both US-OFAC and UK-OFSI), it is consolidated into a single record with individual badges for every designating body.
3. **Verified Crypto Feeds Only (Tier 1)**: The platform only downloads feeds that actually contain verified blockchain wallet addresses, preventing wasted server memory from downloading empty non-crypto government XML files.
4. **No Bitcoin (BTC)**: The system specifically focuses on USDT on TRON (TRC-20), Ethereum (ERC-20), and BSC (BEP-20); all Bitcoin addresses are filtered out.
5. **Real-Time On-Chain Verification**: Complemented by live smart contract RPC calls to verify Tether's official on-chain freeze status.

---

## 2. Active Sanctions Feeds & Official Sources

| # | Sanctioning Body / Regulator | Tag in Platform | Official Direct Feed Source | Focus & Assets |
|:---|:---|:---:|:---|:---|
| **1** | **United States Department of the Treasury (OFAC)** | `US-OFAC` | • `0xB10C/sanctioned_addresses_TRX.json`<br>• `0xB10C/sanctioned_addresses_ETH.json`<br>• `0xB10C/sanctioned_addresses_BSC.json`<br>• `https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv` | Specially Designated Nationals (SDN) and blocked digital currency addresses under OFAC sanctions. |
| **2** | **Israel National Bureau for Counter Terror Financing (NBCTF)** | `IL-NBCTF` | • `https://data.opensanctions.org/datasets/latest/il_mod_crypto/targets.simple.csv` | Official administrative seizure orders (580+ addresses, 99.5% TRON TRC-20 USDT) targeting Hamas, Palestinian Islamic Jihad, and Hezbollah. |
| **3** | **United Kingdom: Foreign, Commonwealth & Development Office (FCDO / OFSI)** | `UK-OFSI` | • `https://data.opensanctions.org/datasets/latest/gb_fcdo_sanctions/targets.simple.csv` | Official UK Sanctions List designations targeting Russian cybercrime, LockBit ransomware, and sanctions evasion. |
| **4** | **Japan: Ministry of Finance & Foreign Affairs (MOFA / METI)** | `JAPAN-MOFA` | • `https://data.opensanctions.org/datasets/latest/jp_mof_sanctions/targets.simple.csv` | Japan Foreign Exchange and Foreign Trade Act (FEFTA) asset freeze notices targeting DPRK cyber networks. |
| **5** | **FBI Cyber / US Department of Justice** | `FBI-CYBER` | • `https://data.opensanctions.org/datasets/latest/us_fbi_lazarus_crypto/targets.simple.csv` | State-sponsored cybercrime addresses attributed to Lazarus Group (DPRK). |
| **6** | **Tether USDT Smart Contract (On-Chain)** | `TETHER ON-CHAIN` | • **TRON RPC Gateway**: `https://api.trongrid.io/wallet/triggerconstantcontract`<br>• **Contract**: `TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t`<br>• **Method**: `getBlackListStatus(address)` | Live blockchain query verifying if Tether Ltd has permanently frozen USDT tokens in the address on-chain. |

---

## 3. Why Other Government Lists (EU, UN, Canada, Australia) Are Handled Differently

Many official government sanctions lists do **not** contain cryptocurrency addresses:

* **European Union (EU)**: The official EU XML (`xmlFullSanctionsList_1_1`) contains **0** crypto wallet fields (only names, passports, and company records).
* **United Nations (UN)**: The UN Consolidated List (`consolidated.xml`) contains **0** crypto wallet fields (only names, generals, and vessels).
* **Canada (SEMA)**: The Canadian Autonomous Sanctions XML (`sema-lmes.xml`) contains **0** crypto wallet fields.
* **Australia (DFAT)**: The Australian Consolidated List (`regulation8_consolidated.xlsx`) contains **0** crypto wallet fields.

> **Decision**: To optimize memory and performance, the platform does **not** download 25+ MB XML files that lack cryptocurrency data. Instead, only Tier 1 authorities with verified on-chain addresses are ingested directly.

---

## 4. Ingestion & Storage Architecture

```
                                  [ External Feeds ]
                                          │
       ┌───────────────┬──────────────────┼─────────────────┬───────────────┐
       ▼               ▼                  ▼                 ▼               ▼
   [ US-OFAC ]    [ IL-NBCTF ]      [ JAPAN-MOFA ]     [ UK-OFSI ]    [ FBI-CYBER ]
   (0xB10C/SDN)  (Israel NBCTF)     (Japan FEFTA)     (UK Sanctions)  (Lazarus DPRK)
       │               │                  │                 │               │
       └───────────────┴──────────────────┼─────────────────┴───────────────┘
                                          ▼
                         [ sanctionsDownloader.js ]
                                          │
                       - Address Normalization (TRON / EVM)
                       - Bitcoin / Non-USDT Filter
                       - Multi-Provider Deduplication
                                          │
                                          ▼
                             data/sanctions-cache.json
                                 (1,109 Addresses)
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         [ Screening Simulator ]                       [ Sanctioned Directory ]
         POST /api/kyt/screen                          GET /api/kyt/sanctions
         (+ Live Tether RPC)                           POST /api/kyt/sanctions/sync
```

1. **Downloader Module** ([`src/lib/intelligence/sanctionsDownloader.js`](src/lib/intelligence/sanctionsDownloader.js)):
   - Streams live directly from official remote URLs over HTTP (no local CSV/JSON/XLS files required).
   - Ingests `0xB10C` curated raw blockchain feeds + `dedicatedOpenSanctions` feeds + Bulk OpenSanctions Sanctions feed.
   - Tags all OpenSanctions-sourced records with `OPENSANCTIONS` alongside specific authority badges (`US-OFAC`, `IL-NBCTF`, `UK-OFSI`, `JAPAN-MOFA`, `FBI-CYBER`).
   - Normalizes EVM addresses (`0x...` lowercase) and TRON addresses (`T...` trimmed).
   - Filters out non-USDT / Bitcoin addresses.
   - Upserts and groups multiple designating providers under each address.
   - Writes consolidated payload to `data/sanctions-cache.json`.

2. **Registry Lookup** ([`src/lib/intelligence/sanctionsRegistry.js`](src/lib/intelligence/sanctionsRegistry.js)):
   - Loads the local JSON cache into memory for **O(1)** synchronous lookups during transaction screening.

3. **Entity Attribution** ([`src/lib/intelligence/entityAttribution.js`](src/lib/intelligence/entityAttribution.js)):
   - Checks on-chain Tether blacklist via RPC.
   - Cross-references official sanctions cache.
   - Merges evidence so if an address is both on OFAC and Tether-frozen, both proofs are surfaced.

4. **Risk Scorer** ([`src/lib/engine/riskScorer.js`](src/lib/engine/riskScorer.js)):
   - Calculates risk score (0 to 100).
   - Generates compliance action (`BLOCK_AND_FREEZE`, `REJECT`, `APPROVE`).
   - Propagates provider badges, jurisdictions, and evidence.

---

## 5. API Endpoints

### `POST /api/kyt/sanctions/sync`
Triggers an on-demand re-download and re-aggregation of all remote feeds.
* **Response**: Returns `totalCount`, `providerCounts`, and `chainCounts`.

### `GET /api/kyt/sanctions`
Retrieves paginated, searchable sanctions records from the local cache.
* **Query Parameters**:
  * `page` (default: 1)
  * `limit` (default: 20)
  * `chain` (e.g., `TRON`, `ETHEREUM`, `BSC`)
  * `provider` (e.g., `US-OFAC`, `IL-NBCTF`, `JAPAN-MOFA`, `UK-OFSI`, `FBI-CYBER`)
  * `search` (address or entity substring)

### `POST /api/kyt/screen`
Performs end-to-end compliance screening on a wallet address or transaction.
* **Request Body**:
  ```json
  {
    "chain": "TRON",
    "from": "TAkpWPt2JZdiLSkG7ZX2VAQkZQsnGZ1nqh",
    "amountUsdt": 1000
  }
  ```
* **Response**: Full risk assessment including risk score, risk level, recommended action, provider tags (`[US-OFAC]`, `[UK-OFSI]`), on-chain Tether state, and audit flow.
