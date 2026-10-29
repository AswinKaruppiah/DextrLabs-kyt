// Usage: npm run collect:intel [-- --only=ofac-sdn,tether-usdt-tron] [--accept-shrink=ofac-sdn]
import fs from "node:fs";

// Plain `node` doesn't read .env (Next.js does), so load optional keys like TRONSCAN_API_KEY
// and ETH_RPC_URL here. Variables already set in the environment win; a missing .env is fine.
try {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}

const { runCollection } = await import("../src/lib/collector/run.js");
const { closeDb } = await import("../src/lib/collector/db.js");

const listArg = (name) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).split(",").filter(Boolean) : null;
};
const only = listArg("only");
const acceptShrink = listArg("accept-shrink") || [];

console.log("Collecting threat intelligence -> MongoDB");
let run;
try {
  run = await runCollection({ only, acceptShrink });
} finally {
  await closeDb();
}

console.log(`\nRun ${run.runId} done in ${(run.durationMs / 1000).toFixed(1)}s`);
const t = run.totals;
console.log(`  entries: ${t.entries} (${t.active} active, ${t.delisted} delisted), ${t.written} written`);
console.log(`  since last run: +${t.added} new, ${t.newlyDelisted} delisted, ${t.relisted} re-listed`);
for (const w of run.warnings) console.log(`  ! ${w.sourceId}: ${w.message}`);
if (run.warnings.some((w) => w.kind !== "cross-check")) process.exitCode = 1;
