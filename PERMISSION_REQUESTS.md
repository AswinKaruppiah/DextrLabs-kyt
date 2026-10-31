# Data Permission Requests

Three data sources would add about **70,000** risky wallets to the KYT database (85,232 on 2026-10-30), taking it well past 100k. Each one is free to download, but we may not use it in our product until the owner agrees in writing. Nothing from these sources is collected until a reply allows it.

## Status

| Source | New wallets | Chain | Why permission is needed | Contact | Sent | Reply |
|---|---|---|---|---|---|---|
| Blockscout address tags | ~60–67k | ETH, BSC | No published terms for the tag data; most labels come from third parties (Etherscan-style `Fake_Phishing`, ChainPatrol, Match Systems) | Blockscout contact form / API sales | – | – |
| Bybit Lazarus bounty feed | ~6–11k (reported) | ETH, BSC, TRON | The public file blocks automated access; terms are unclear | Contact on lazarusbounty.com | – | – |
| CMU address-poisoning dataset | 4,199 (payoff files) / ~6.5M (full dump) | ETH, BSC | Licence is CC BY-NC-ND 4.0 (non-commercial, no derivatives) | ttsuchiy@andrew.cmu.edu, cc nicolasc@andrew.cmu.edu | – | – |

Fill in **Sent** and **Reply** as they happen. When a reply allows use, the source can be built and documented in [DATA_SOURCES.md](DATA_SOURCES.md).

Links:
- Blockscout: https://eth.blockscout.com · Metadata Service docs: https://docs.blockscout.com/devs/metadata-service.md · Terms: https://eaas.blockscout.com/terms-and-conditions
- Bybit bounty: https://lazarusbounty.com
- CMU dataset: https://kilthub.cmu.edu/articles/dataset/Blockchain_Address_Poisoning_Companion_Dataset_/29212703/1

---

## 1. Blockscout

**To:** Blockscout team (website contact form or API sales; no published email found)
**Subject:** Permission to use Blockscout address tags in a KYT screening product

> Hello Blockscout team,
>
> We're dextrlabs. We're building a KYT (Know Your Transaction) screening tool for USDT payments on Ethereum, BSC and TRON.
>
> We'd like to use the risk tags in your Metadata Service, such as "Phish / Hack", "Poisoning Address", "Scam", "Exploit" and "Heist", to flag risky wallets in our product. We would store the tagged addresses in our own database and refresh them about once a week.
>
> Could you tell us:
> 1. Whether we may use and store this tag data in a commercial product, and on what terms.
> 2. Whether we should use your keyed API (api.blockscout.com) instead of the public endpoint, and what it costs.
> 3. Whether Blockscout has the right to share the labels that come from third parties (for example Etherscan-style "Fake_Phishing" labels, ChainPatrol or Match Systems), or whether we would also need their permission.
>
> We're happy to credit Blockscout in our product.
>
> Thank you,
> [Your name]
> dextrlabs

---

## 2. Bybit / Lazarus Bounty

**To:** Bybit Lazarus Bounty team (contact on lazarusbounty.com)
**Subject:** Access to the Bybit hack address list for AML screening

> Hello,
>
> We're dextrlabs. We're building a KYT (Know Your Transaction) screening tool for USDT payments.
>
> We'd like to use the list of addresses linked to the February 2025 Bybit hack (published via hackscan.hackbounty.io) to flag stolen funds in our product. This would help stop laundered funds from passing through our customers.
>
> Could you tell us:
> 1. Whether we may use this address list in a commercial screening product.
> 2. Whether there is an official API, key or export for automated access (the public file blocks automated requests).
> 3. Any terms or credit you would like.
>
> Thank you,
> [Your name]
> dextrlabs

---

## 3. CMU address-poisoning dataset

**To:** ttsuchiy@andrew.cmu.edu
**Cc:** nicolasc@andrew.cmu.edu
**Subject:** Commercial-use permission for the Blockchain Address Poisoning dataset

> Dear Dr. Tsuchiya and Prof. Christin,
>
> We're dextrlabs. We're building a KYT (Know Your Transaction) screening tool for USDT payments. We read your USENIX Security 2025 paper, "Blockchain Address Poisoning", and found your companion dataset very valuable.
>
> The dataset is licensed CC BY-NC-ND 4.0, so we're asking for permission before any use. We would like to use:
> 1. The attacker addresses from `payoff_transfers_ethereum.csv` and `payoff_transfers_bsc.csv`, to flag poisoning wallets that received stolen funds.
> 2. If possible, the look-alike attacker addresses from the full Ethereum dataset, and the BSC data mentioned in the paper.
>
> We would store only the attacker addresses, never victim addresses, and credit your paper in our product.
>
> Could you let us know whether commercial use is possible, and under what conditions?
>
> Kind regards,
> [Your name]
> dextrlabs
