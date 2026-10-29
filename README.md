# DextrLabs-KYT: Multi-Chain USDT Sanctions & Compliance Platform

Real-time Know-Your-Transaction (KYT) screening and threat intelligence registry for USDT across **TRON (TRC-20)**, **Ethereum (ERC-20)**, and **BNB Smart Chain (BEP-20)**.

---

## Key Features

* **Multi-Source Real-Time Sanctions Ingestion**: Dynamic synchronization across verified Tier 1 government authorities (US-OFAC, Israel-NBCTF, Japan-MOFA, UK-OFSI, FBI-Cyber).
* **Multi-Provider Deduplication**: Groups cross-listed addresses into a single entry with individual badges for every designating authority.
* **On-Chain Smart Contract Freeze Verification**: Direct real-time RPC integration querying Tether's smart contract state (`getBlackListStatus`).
* **Zero Mock Lists / Zero In-Code Fallbacks**: All records are dynamically ingested and stored in local cache (`data/sanctions-cache.json`).
* **Interactive Dashboard**:
  * **Check Wallet**: Instant transaction risk assessment with good/bad verdict and multi-jurisdiction attribution.
  * **Sanctioned Wallets Directory**: Searchable, paginated directory with live authority and blockchain filters.

---

## Sanctions Architecture & Feeds

For full details on the exact feeds, government sources, and data flow architecture, see **[`SANCTIONS_INTELLIGENCE.md`](SANCTIONS_INTELLIGENCE.md)**.

---

## Getting Started

### 1. Environment Setup

Create or verify `.env` in the project root:
```env
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
TRONGRID_HOST=https://api.trongrid.io
TRONGRID_API_KEY=your_trongrid_api_key
TRON_USDT_CONTRACT_HEX=41a614f803b6fd780986a42c78ec9c7f77e6ded13c
NEXT_PUBLIC_USDT_TRON_CONTRACT=TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t
NEXT_PUBLIC_USDT_ETH_CONTRACT=0xdAC17F958D2ee523a2206206994597C13D831ec7
NEXT_PUBLIC_USDT_BSC_CONTRACT=0x55d398326f99059fF775485246999027B3197955
```

### 2. Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Build & Production

```bash
npm run build
npm start
```

---

## API Endpoints

* `POST /api/kyt/screen` &mdash; Screen a wallet or transaction for sanctions and Tether freezes.
* `GET /api/kyt/sanctions` &mdash; Query and filter the active local sanctions directory.
* `POST /api/kyt/sanctions/sync` &mdash; Trigger an on-demand re-sync across all remote regulatory feeds.
