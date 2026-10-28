import { randomUUID } from "node:crypto";
import { CollectionBusyError, runCollection } from "./run.js";
import { invalidateIntelCache } from "./store.js";
import { SOURCES } from "./sources/index.js";

// One sync job per server process. Kept on globalThis so `next dev` module reloads
// don't lose track of a run that is still going.
const state = (globalThis.__kytIntelSync ??= { job: null });

const publicJob = (job) => job && structuredClone(job);

/** The running job, or the last finished one (null if none since the server started). */
export const getSyncJob = () => publicJob(state.job);

/**
 * Starts a background collection, or returns the one already running.
 * @returns {{ started: boolean, job: object }}
 */
export function startSync({ only = null, acceptShrink = [] } = {}) {
  if (state.job?.status === "running") return { started: false, job: publicJob(state.job) };

  const selected = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  const job = {
    id: randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    only,
    acceptShrink,
    sources: Object.fromEntries(
      selected.map((s) => [s.id, { status: "pending", records: null, error: null, detail: null }]),
    ),
    result: null,
    error: null,
  };
  state.job = job;

  runCollection({
    only,
    acceptShrink,
    log: (line) => console.log("[IntelSync]" + line),
    onProgress: ({ sourceId, status, records, error, detail }) => {
      const s = job.sources[sourceId];
      if (!s) return;
      s.status = status;
      if (records !== undefined) s.records = records;
      if (error !== undefined) s.error = error;
      s.detail = detail ?? (status === "running" ? s.detail : null);
    },
  })
    .then((manifest) => {
      invalidateIntelCache();
      job.status = "done";
      job.result = { runAt: manifest.runAt, totals: manifest.totals, warnings: manifest.warnings };
    })
    .catch((err) => {
      console.error("[IntelSync] error:", err);
      job.status = "failed";
      job.error = err instanceof CollectionBusyError ? `Not started: ${err.message}` : err.message;
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });

  return { started: true, job: publicJob(job) };
}
