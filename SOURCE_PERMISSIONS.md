# Data Source Cost & Permission Check

The 23 threat-intel sources used by the collector (`npm run collect:intel`), checked on 2026-11-02.

- **Cost:** all 23 are free. None needs a paid plan.
- **Permission:** 19 can be used as they are. 4 need written permission before commercial use (rows 20–23).

| # | Source | Pay? | Permission? |
|---|---|---|---|
| 1 | OFAC SDN | Free | ✅ Not needed |
| 2 | OFAC 0xB10C | Free | ✅ Not needed |
| 3 | EU sanctions | Free | ✅ Not needed |
| 4 | UK Sanctions List | Free | ✅ Not needed |
| 5 | UN Consolidated List | Free | ✅ Not needed |
| 6 | Israel NBCTF | Free | ✅ Not needed |
| 7 | FBI IC3 | Free | ✅ Not needed |
| 8 | Tether USDT TRON | Free | ✅ Not needed |
| 9 | Tether USDT ETH | Free | ✅ Not needed |
| 10 | Circle USDC/EURC | Free | ✅ Not needed |
| 11 | Paxos USDP/PYUSD | Free | ✅ Not needed |
| 12 | TrueUSD | Free | ✅ Not needed |
| 13 | MEW darklist | Free | ✅ Not needed |
| 14 | Forta | Free | ✅ Not needed |
| 15 | DeFiHackLabs | Free | ✅ Not needed |
| 16 | Lazarus / tayvano | Free | ✅ Not needed |
| 17 | Hugging Face fraud dataset | Free | ✅ Not needed (must credit authors) |
| 18 | Court-judgment fraud (Mendeley) | Free | ✅ Not needed (must credit authors) |
| 19 | ScamSniffer | Free | ✅ Not needed |
| 20 | eth-labels Phish/Hack | Free | ⚠️ Needed (Etherscan) |
| 21 | eth-labels exploits | Free | ⚠️ Needed (Etherscan) |
| 22 | Poison-Hunter | Free | ⚠️ Needed (authors) |
| 23 | Drainer-as-a-Service | Free | ⚠️ Needed (BlockSec authors) |

---

## Why 20 & 21 need permission (Etherscan)

The data in these two sources belongs to **Etherscan**.

1. Etherscan creates the address labels ("Phish / Hack", "Bybit Exploiter", …).
2. The **eth-labels** GitHub repo copied those labels from Etherscan.
3. We copy the eth-labels repo.

The repo has an MIT licence, but the repo owner can't give away data that isn't theirs. The labels still belong to Etherscan.

Etherscan's [Terms of Service](https://etherscan.io/terms) say:
- **Section 8:** you may not copy their "public labels or name tags" without permission. This applies even when the data was "obtained through third parties", so getting it from GitHub instead of Etherscan doesn't help.
- **Section 10:** any copying needs their "express and written permission".

**In short:** getting the labels from a GitHub copy doesn't make them free to use. They're still Etherscan's, and Etherscan says no without permission.

**What to do:** stop using 20 and 21. If we want this data, ask Etherscan for permission or pay for their [Metadata service](https://docs.etherscan.io/metadata/introduction).

---

## Why 22 & 23 need permission (no licence)

The GitHub repos for **Poison-Hunter** ([DS2L/Poison-Hunter](https://github.com/DS2L/Poison-Hunter)) and **Drainer-as-a-Service** ([blocksecteam/DaaS_dataset](https://github.com/blocksecteam/DaaS_dataset)) have **no licence file**.

**"No licence" means the authors never said what other people may do with their work.** When that happens, copyright law defaults to **"all rights reserved"**: only the authors may use it.

| ✅ Allowed | ❌ Not allowed without asking |
|---|---|
| Viewing it on GitHub | Copying it into our product or database |
| Downloading it to look at | Commercial use |
| | Sharing it or building on it |

A public repo isn't the same as free to use. A licence (MIT, Apache, CC0, …) is the authors saying in writing "you may use this". Without one, there's no such permission.

Poison-Hunter has one more issue: its addresses were also labelled using Etherscan, so part of its data has the same problem as 20 and 21.

**What to do:** email the authors and ask for permission. Researchers often agree, especially if we credit their paper. Track the requests in [PERMISSION_REQUESTS.md](PERMISSION_REQUESTS.md).

---

*This is a technical review, not legal advice. Have a lawyer confirm it before a commercial launch.*
