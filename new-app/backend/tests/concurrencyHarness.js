'use strict';

/**
 * Stage 5 concurrency harness.
 *
 * There is no reachable MongoDB in the verification environment
 * (mongodb-memory-server's binary download is blocked by the outbound
 * proxy -- fastdl.mongodb.org returns 403). Rather than fall back to
 * code-reading only, this harness models MongoDB's real multi-document
 * transaction semantics closely enough to actually EXECUTE the real
 * service-layer code under genuine concurrent interleaving and observe the
 * result:
 *
 *  - Each `withTransaction(deps, fn)` attempt runs `fn` against a FRESH,
 *    fully isolated clone of the committed store -- exactly what MongoDB's
 *    snapshot-read-concern transaction gives a transaction: it never sees
 *    another in-flight transaction's uncommitted writes.
 *  - At the end of a successful `fn`, the attempt tries to commit: if no
 *    OTHER transaction has committed since this attempt's snapshot was
 *    taken, the clone's state is copied back as the new committed state.
 *    If another transaction DID commit in between, this attempt is
 *    discarded and `fn` is re-run from scratch against a fresh snapshot --
 *    exactly what the real `session.withTransaction()` driver helper does
 *    on a MongoDB TransientTransactionError (WriteConflict): it retries the
 *    callback, not just the write.
 *  - The version conflict check is at the whole-store level (coarser than
 *    real MongoDB's per-document conflict detection). That is strictly
 *    MORE conservative: it can force more retries than production MongoDB
 *    would, but it can never let two conflicting writes silently both
 *    "win" the way a plain in-memory fake (snapshot/restore only, no
 *    concurrent-attempt isolation) would -- so it cannot manufacture a
 *    false PASS by being too lenient, only waste retries.
 *  - Reads/writes a service makes BEFORE calling `deps.withTransaction`
 *    (e.g. an existence check) are, correctly, plain reads against the
 *    live committed store -- exactly matching a non-session Mongoose call
 *    in the real repositories, which can legitimately be stale by the time
 *    the transaction starts.
 *
 * This lets the ACTUAL service modules under test/, completely unmodified,
 * be driven with real `Promise.all(...)` concurrent calls and their
 * outcome checked against MongoDB's actual guarantees, without a live
 * mongod. Documented explicitly in STEP_5_CONCURRENCY_ATOMICITY.md as a
 * simulated-MongoDB-semantics harness, not a literal MongoDB integration
 * test.
 */

const { createEnquiryFakeStore } = require('./enquiryFakes');

function cloneDeep(v) {
  return JSON.parse(JSON.stringify(v));
}

function createAtomicStore(seed = {}) {
  const committed = createEnquiryFakeStore(seed);
  committed.__version = 0;

  committed.withTransaction = async (_deps, fn) => {
    const MAX_ATTEMPTS = 50;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const baseVersion = committed.__version;
      const snapshot = cloneDeep(committed.state);
      const attemptStore = createEnquiryFakeStore(snapshot);
      const txnDeps = { ...attemptStore, session: { fakeSession: true, attempt } };

      // eslint-disable-next-line no-await-in-loop
      const result = await fn(txnDeps);

      if (committed.__version === baseVersion) {
        for (const key of Object.keys(attemptStore.state)) {
          committed.state[key] = attemptStore.state[key];
        }
        committed.__version += 1;
        return result;
      }
      // Conflict: someone else committed first. Retry fn from a fresh
      // snapshot -- exactly what session.withTransaction() does on a real
      // WriteConflict/TransientTransactionError.
    }
    throw new Error('Stage5 harness: too many transaction retries (possible livelock)');
  };

  return committed;
}

module.exports = { createAtomicStore, cloneDeep };
