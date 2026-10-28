// Usage: npm run collect:intel [-- --only=ofac-sdn,tether-usdt-tron]
import { runCollection, INTEL_DIR } from "../src/lib/collector/run.js";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").filter(Boolean) : null;

console.log(`Collecting threat intelligence -> ${INTEL_DIR}`);
const manifest = await runCollection({ only });

console.log(`\nDone in ${(manifest.durationMs / 1000).toFixed(1)}s`);
console.log(
  `  entries: ${manifest.totals.entries}  (+${manifest.totals.added} / -${manifest.totals.removed} since last run)`,
);
const ofac = manifest.crossCheck.ofac;
if (ofac && (ofac.onlyInOfacDirect.length || ofac.onlyIn0xB10C.length)) {
  console.log(
    `  OFAC cross-check mismatch: ${ofac.onlyInOfacDirect.length} only in SDN.XML, ${ofac.onlyIn0xB10C.length} only in 0xB10C`,
  );
}
const failed = manifest.sources.filter((s) => s.status !== "ok");
if (failed.length) {
  console.log(`  ${failed.length} source(s) not fresh: ${failed.map((s) => `${s.id}=${s.status}`).join(", ")}`);
  process.exitCode = 1;
}
