import { MongoClient } from "mongodb";

// One client per process. Kept on globalThis so `next dev` module reloads reuse the pool.
const state = (globalThis.__kytMongo ??= { client: null, ready: null });

/**
 * The intel database on MongoDB Atlas (MONGODB_URI, database MONGODB_DB or "dextrlabs_kyt").
 *  - intel_wallets:     one document per chain:address (`_id` = key), see DATA_SOURCES.md
 *  - intel_sync_runs:   one document per collection run: when, per-source status, warnings, errors
 *  - intel_run_wallets: one document per wallet a run added, delisted, re-listed or changed sources on
 *  - intel_sync_errors: one document per source that failed during a run (or per run that crashed)
 */
export function getDb() {
  if (!state.ready) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new Error("MONGODB_URI is not set — add your MongoDB Atlas connection string to .env"));
    // ignoreUndefined: an unset field is left out instead of stored as null, so a stored
    // wallet compares equal to the same wallet rebuilt by the next run.
    const client = new MongoClient(uri, { ignoreUndefined: true });
    state.client = client;
    state.ready = client
      .connect()
      .then(async () => {
        const db = client.db(process.env.MONGODB_DB || "dextrlabs_kyt");
        await ensureIndexes(db);
        return db;
      })
      .catch((err) => {
        state.client = null;
        state.ready = null;
        throw err;
      });
  }
  return state.ready;
}

export const walletsCollection = async () => (await getDb()).collection("intel_wallets");
export const syncRunsCollection = async () => (await getDb()).collection("intel_sync_runs");
export const runWalletsCollection = async () => (await getDb()).collection("intel_run_wallets");
export const syncErrorsCollection = async () => (await getDb()).collection("intel_sync_errors");

async function ensureIndexes(db) {
  await Promise.all([
    // Directory default order: newest first, then most severe.
    db.collection("intel_wallets").createIndex({ firstSeen: -1, tier: 1, confidence: -1, _id: 1 }),
    // At most one run in progress: this index is the cross-process collection lock.
    db
      .collection("intel_sync_runs")
      .createIndex({ status: 1 }, { unique: true, partialFilterExpression: { status: "running" } }),
    db.collection("intel_sync_runs").createIndex({ status: 1, finishedAt: -1 }),
    db.collection("intel_run_wallets").createIndex({ runId: 1, change: 1 }),
    db.collection("intel_run_wallets").createIndex({ key: 1, runAt: -1 }),
    db.collection("intel_sync_errors").createIndex({ failedAt: -1 }),
    db.collection("intel_sync_errors").createIndex({ sourceId: 1, failedAt: -1 }),
    db.collection("intel_sync_errors").createIndex({ runId: 1 }),
  ]);
}

/** Closes the connection so a CLI process can exit. */
export async function closeDb() {
  const { client } = state;
  state.client = null;
  state.ready = null;
  await client?.close();
}
