import { openDatabaseAsync } from 'expo-sqlite';

const DB_NAME = 'bloodscroll.db';
let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDatabaseAsync(DB_NAME);
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS scan_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          engine TEXT NOT NULL,
          status TEXT NOT NULL,
          matched_by TEXT,
          confidence REAL,
          latency_ms INTEGER,
          false_positive INTEGER DEFAULT 0
        );`
      );
      return db;
    })();
  }
  return dbPromise;
}

export async function recordScanMetric(metric = {}) {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO scan_metrics
       (created_at, engine, status, matched_by, confidence, latency_ms, false_positive)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        new Date().toISOString(),
        String(metric.engine ?? 'unknown'),
        String(metric.status ?? 'unknown'),
        metric.matchedBy == null ? null : String(metric.matchedBy),
        metric.confidence == null ? null : Number(metric.confidence),
        metric.latencyMs == null ? null : Math.round(Number(metric.latencyMs)),
        metric.falsePositive ? 1 : 0,
      ]
    );
  } catch {
    // Non-blocking telemetry path.
  }
}

export async function getScanMetricsSummary({ sinceDays = 7 } = {}) {
  const db = await getDb();
  const sinceDate = new Date(Date.now() - Math.max(1, Number(sinceDays) || 7) * 24 * 60 * 60 * 1000).toISOString();

  const totals = await db.getFirstAsync(
    `SELECT
       COUNT(1) AS total,
       SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched,
       SUM(CASE WHEN status = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous,
       SUM(CASE WHEN false_positive = 1 THEN 1 ELSE 0 END) AS false_positive,
       AVG(latency_ms) AS avg_latency_ms
     FROM scan_metrics
     WHERE created_at >= ?;`,
    [sinceDate]
  );

  const total = Number(totals?.total ?? 0) || 0;
  const matched = Number(totals?.matched ?? 0) || 0;
  const ambiguous = Number(totals?.ambiguous ?? 0) || 0;
  const falsePositive = Number(totals?.false_positive ?? 0) || 0;
  const avgLatencyMs = totals?.avg_latency_ms == null ? null : Math.round(Number(totals.avg_latency_ms));

  return {
    total,
    matched,
    ambiguous,
    falsePositive,
    directMatchRate: total ? matched / total : 0,
    ambiguousRate: total ? ambiguous / total : 0,
    falsePositiveRate: total ? falsePositive / total : 0,
    avgLatencyMs,
  };
}
