import { NextResponse } from "next/server";
import { evaluateTransactionRisk } from "@/lib/engine/riskScorer";
import { evaluateComplianceRules } from "@/lib/rules/ruleEngine";

// Initial seed alerts showcasing realistic USDT compliance scenarios across TRON, Ethereum, and BSC
const INITIAL_DEMO_ALERTS = [
  // ==================== TRON (TRC-20) ALERTS ====================
  {
    id: "ALT-TRON-101",
    chain: "TRON",
    txHash: "4b9c1d8e2f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b01",
    from: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9", // Lazarus OFAC
    to: "TNDU9Z68eKx6H5k9bU1wX7Y8Z9kQ4V1m8K",
    amountUsdt: 75000.0,
    timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    status: "OPEN",
    assignedTo: "Sarah Jenkins (Senior AML Analyst)",
    notes: [
      {
        author: "System Automated Rule Engine",
        timestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        text: "RULE_OFAC_FREEZE triggered: Direct sender address explicitly listed on US Treasury OFAC SDN registry under DPRK cyber program.",
      },
    ],
  },
  {
    id: "ALT-TRON-102",
    chain: "TRON",
    txHash: "7a8b9c1d8e2f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a92",
    from: "TDqP8VvBknWk4C38Gv6HjL8kQ9bU1wX4Q9", // Tether frozen KK Park
    to: "TWd4vBknWk4C38Gv6HjL8kQ9bU1wZ9K3P2",
    amountUsdt: 250000.0,
    timestamp: new Date(Date.now() - 34 * 60 * 1000).toISOString(),
    status: "IN_REVIEW",
    assignedTo: "David Kim (Lead Investigator)",
    notes: [
      {
        author: "David Kim",
        timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        text: "Confirmed on-chain Tether AddedBlackList event on TRON contract. Coordinated with T3 Financial Crime Unit contact.",
      },
    ],
  },
  {
    id: "ALT-TRON-103",
    chain: "TRON",
    txHash: "9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b4b9c1d8e2f4a5b6c7d8e03",
    from: "TScam8vBknWk4C38Gv6HjL8kQ9bU1wK8P1", // KK Park Scam Syndicate
    to: "TPyjyZvBknWk4C38Gv6HjL8kQ9bU1wZ9K3", // OKX Settlement
    amountUsdt: 38500.0,
    timestamp: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
    status: "OPEN",
    assignedTo: "Unassigned",
    notes: [
      {
        author: "Automated Threat Intel Feed",
        timestamp: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
        text: "Flagged: High-confidence attribution to KK Park industrial romance/crypto investment scam syndicate in Myanmar.",
      },
    ],
  },
  {
    id: "ALT-TRON-104",
    chain: "TRON",
    txHash: "2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b",
    from: "TKzBDW5kPqSL69c5eC26b4N6W5vT4HkU9k", // Binance TRON
    to: "TWd4vBknWk4C38Gv6HjL8kQ9bU1wZ9K3P2",
    amountUsdt: 12400.0,
    timestamp: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
    status: "CLOSED",
    assignedTo: "System Auto-Settlement",
    notes: [
      {
        author: "System Auto-Settlement",
        timestamp: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
        text: "Clean inter-exchange transfer between verified TRON VASP hot wallets. Automatically cleared.",
      },
    ],
  },

  // ==================== ETHEREUM (ERC-20) ALERTS ====================
  {
    id: "ALT-ETH-201",
    chain: "ETHEREUM",
    txHash: "0x89e2f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b4b9c101",
    from: "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b", // Tornado Cash Router
    to: "0x28C6c06298d514Db089934071355E5743bf21d60", // Binance 14
    amountUsdt: 120000.0,
    timestamp: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    status: "OPEN",
    assignedTo: "Sarah Jenkins (Senior AML Analyst)",
    notes: [
      {
        author: "System Automated Rule Engine",
        timestamp: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
        text: "RULE_OFAC_FREEZE triggered: Direct interaction with Tornado Cash core mixer router (OFAC SDN 11029). Immediate asset freeze initiated.",
      },
    ],
  },
  {
    id: "ALT-ETH-202",
    chain: "ETHEREUM",
    txHash: "0x3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b4b9c1d8e2f4a5b6c7d8e9f0a1b2102",
    from: "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a", // Multichain Exploit Loot (Tether Frozen)
    to: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d", // Binance 16
    amountUsdt: 500000.0,
    timestamp: new Date(Date.now() - 48 * 60 * 1000).toISOString(),
    status: "ESCALATED",
    assignedTo: "Elena Rostova (Compliance Director)",
    notes: [
      {
        author: "Elena Rostova",
        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        text: "On-chain frozen Tether wallet associated with Multichain liquidity bridge compromise. Prepared emergency filing dossier.",
      },
    ],
  },
  {
    id: "ALT-ETH-203",
    chain: "ETHEREUM",
    txHash: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a03",
    from: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d", // Binance 16
    to: "0x6cC5F688a30d3790e980271DE884772113c450ada", // Kraken ERC-20
    amountUsdt: 45000.0,
    timestamp: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
    status: "CLOSED",
    assignedTo: "System Auto-Settlement",
    notes: [
      {
        author: "System Auto-Settlement",
        timestamp: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
        text: "Inter-exchange institutional ERC-20 USDT settlement between verified VASPs. Passed compliance screening.",
      },
    ],
  },

  // ==================== BSC (BEP-20) ALERTS ====================
  {
    id: "ALT-BSC-301",
    chain: "BSC",
    txHash: "0x5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b4b9c1d8e2f4a5b6c7d8e9f0a1b2c3d4103",
    from: "0x3c7885b54687C5f92Aeb9d4a4d658C08A46eF915", // PinkDrainer BEP-20 (Tether Frozen)
    to: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", // Binance BSC Hot Wallet
    amountUsdt: 95000.0,
    timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    status: "OPEN",
    assignedTo: "David Kim (Lead Investigator)",
    notes: [
      {
        author: "System Automated Rule Engine",
        timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        text: "RULE_TETHER_BLACKLIST: Wallet frozen on BSC (BEP-20) contract for automated drainer campaign proceeds.",
      },
    ],
  },
  {
    id: "ALT-BSC-302",
    chain: "BSC",
    txHash: "0x9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b04",
    from: "0x7F367cc41522cE07553e823bf3be79A889DEbe1B", // Garantex BSC Gateway
    to: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance 8
    amountUsdt: 64500.0,
    timestamp: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    status: "IN_REVIEW",
    assignedTo: "Sarah Jenkins (Senior AML Analyst)",
    notes: [
      {
        author: "Sarah Jenkins",
        timestamp: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
        text: "Exposure to sanctioned Russian OTC broker cross-chain gateway. Escalated for OFAC compliance determination.",
      },
    ],
  },
  {
    id: "ALT-BSC-303",
    chain: "BSC",
    txHash: "0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a05",
    from: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance 8
    to: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap Router
    amountUsdt: 35000.0,
    timestamp: new Date(Date.now() - 195 * 60 * 1000).toISOString(),
    status: "CLOSED",
    assignedTo: "System Auto-Settlement",
    notes: [
      {
        author: "System Auto-Settlement",
        timestamp: new Date(Date.now() - 195 * 60 * 1000).toISOString(),
        text: "Clean liquidity routing to PancakeSwap v2 verified decentralized AMM router.",
      },
    ],
  },
];

// In-memory store for active session
let alertsStore = null;

async function getOrInitAlerts() {
  if (alertsStore) return alertsStore;

  const initialized = [];
  for (const item of INITIAL_DEMO_ALERTS) {
    const evalResult = await evaluateTransactionRisk({
      txHash: item.txHash,
      from: item.from,
      to: item.to,
      amountUsdt: item.amountUsdt,
      chain: item.chain,
      timestamp: item.timestamp,
      customHops: item.customHops,
    });
    const withRules = evaluateComplianceRules(evalResult);

    initialized.push({
      ...withRules,
      id: item.id,
      chain: item.chain,
      status: item.status,
      assignedTo: item.assignedTo,
      notes: item.notes,
    });
  }

  alertsStore = initialized;
  return alertsStore;
}

export async function GET(request) {
  try {
    const alerts = await getOrInitAlerts();
    const url = new URL(request.url);
    const chainParam = url.searchParams.get("chain");

    let filtered = alerts;
    if (chainParam && chainParam !== "ALL") {
      filtered = alerts.filter(
        (a) => (a.chain || "").toUpperCase() === chainParam.toUpperCase()
      );
    }

    return NextResponse.json({ alerts: filtered, count: filtered.length, total: alerts.length }, { status: 200 });
  } catch (error) {
    console.error("Failed to load alerts:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const alerts = await getOrInitAlerts();

    // Support updating an alert (e.g. status change, note add)
    if (body.action === "UPDATE_STATUS" && body.alertId) {
      const alert = alerts.find((a) => a.id === body.alertId);
      if (alert) {
        alert.status = body.status || alert.status;
        if (body.assignedTo) alert.assignedTo = body.assignedTo;
        if (body.note) {
          alert.notes.push({
            author: body.author || "Compliance Officer",
            timestamp: new Date().toISOString(),
            text: body.note,
          });
        }
        return NextResponse.json({ success: true, alert });
      }
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
