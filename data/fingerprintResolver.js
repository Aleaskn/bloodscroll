import { loadFingerprintRowsForWarmup, searchFingerprintCandidatesByBucket } from './catalogDb';
import { resolveByFingerprintWithRepository } from './fingerprintResolverCore.mjs';

export { resolveByFingerprintWithRepository };

const MAX_RESULT_CACHE_SIZE = 300;
const MEMORY_SEARCH_YIELD_EVERY_ROWS = 64;

const memoryState = {
  warmPromise: null,
  bucketMap: null,
  totalRows: 0,
  warmedAt: 0,
  resultCache: new Map(),
};

function normalizeCollectorNumber(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const match = raw.match(/^0*([0-9]+)([a-z]?)$/);
  if (!match) return raw;
  return `${Number(match[1])}${match[2]}`;
}

function normalizeSetCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/[^a-z0-9]/g, '');
  if (!compact) return '';
  return compact;
}

function cacheResult(cacheKey, result) {
  memoryState.resultCache.set(cacheKey, result);
  if (memoryState.resultCache.size <= MAX_RESULT_CACHE_SIZE) return;
  const oldestKey = memoryState.resultCache.keys().next().value;
  if (oldestKey != null) {
    memoryState.resultCache.delete(oldestKey);
  }
}

function buildCacheKey(input = {}) {
  return [
    Number(input.phash_hi) >>> 0,
    Number(input.phash_lo) >>> 0,
    Number(input.dhash_hi) >>> 0,
    Number(input.dhash_lo) >>> 0,
    Number(input.bucket16) >>> 0,
    normalizeSetCode(input.setCode),
    normalizeCollectorNumber(input.collectorNumber),
  ].join(':');
}

async function searchFingerprintCandidatesFromMemory(
  bucket16,
  { setCode = '', collectorNumber = '', limit = 80, neighborRange = 1 } = {}
) {
  const bucketMap = memoryState.bucketMap;
  if (!bucketMap) {
    return searchFingerprintCandidatesByBucket(bucket16, { setCode, collectorNumber, limit, neighborRange });
  }

  const bucket = Number(bucket16);
  if (!Number.isFinite(bucket)) return [];
  const normalizedSet = normalizeSetCode(setCode);
  const normalizedCollector = normalizeCollectorNumber(collectorNumber);
  const hasEditionFilter = normalizedSet || normalizedCollector;
  const maxLimit = Math.max(1, Math.min(300, Number(limit) || 80));
  const range = Math.max(0, Math.min(6, Number(neighborRange) || 1));

  const byDistanceBuckets = [];
  for (let d = 0; d <= range; d += 1) {
    const lo = bucket - d;
    const hi = bucket + d;
    if (lo >= 0 && lo <= 65535) byDistanceBuckets.push(lo);
    if (d > 0 && hi >= 0 && hi <= 65535) byDistanceBuckets.push(hi);
  }

  const out = [];
  const seen = new Set();
  let scannedRows = 0;
  for (const bucketKey of byDistanceBuckets) {
    const rows = bucketMap.get(bucketKey);
    if (!rows?.length) continue;
    for (const row of rows) {
      scannedRows += 1;
      if ((scannedRows % MEMORY_SEARCH_YIELD_EVERY_ROWS) === 0) {
        // Cooperative yield to keep UI rendering smooth while searching memory buckets.
        await Promise.resolve();
      }
      if (hasEditionFilter) {
        if (normalizedSet && normalizeSetCode(row.set_code) !== normalizedSet) continue;
        if (normalizedCollector && normalizeCollectorNumber(row.collector_number) !== normalizedCollector) continue;
      }
      const key = `${row.card_id}:${row.phash_hi}:${row.phash_lo}:${row.dhash_hi}:${row.dhash_lo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= maxLimit) return out;
    }
  }

  return out;
}

export async function warmFingerprintResolverCache({ chunkSize = 6000 } = {}) {
  if (memoryState.bucketMap) {
    return {
      ready: true,
      totalRows: memoryState.totalRows,
      warmedAt: memoryState.warmedAt,
      source: 'memory',
    };
  }
  if (memoryState.warmPromise) return memoryState.warmPromise;

  memoryState.warmPromise = (async () => {
    const rows = await loadFingerprintRowsForWarmup({ chunkSize });
    const bucketMap = new Map();
    for (const row of rows) {
      const bucket = Number(row?.bucket16);
      if (!Number.isFinite(bucket)) continue;
      const normalizedBucket = (bucket >>> 0) & 0xffff;
      const list = bucketMap.get(normalizedBucket);
      if (list) {
        list.push(row);
      } else {
        bucketMap.set(normalizedBucket, [row]);
      }
    }
    memoryState.bucketMap = bucketMap;
    memoryState.totalRows = rows.length;
    memoryState.warmedAt = Date.now();
    memoryState.resultCache.clear();
    return {
      ready: true,
      totalRows: memoryState.totalRows,
      warmedAt: memoryState.warmedAt,
      source: 'memory',
    };
  })();

  try {
    return await memoryState.warmPromise;
  } catch (error) {
    memoryState.warmPromise = null;
    throw error;
  }
}

export function getFingerprintResolverCacheInfo() {
  return {
    ready: !!memoryState.bucketMap,
    totalRows: memoryState.totalRows,
    warmedAt: memoryState.warmedAt,
    cachedResults: memoryState.resultCache.size,
  };
}

export async function resolveByFingerprint({
  phash_hi,
  phash_lo,
  dhash_hi,
  dhash_lo,
  bucket16,
  setCode,
  collectorNumber,
  editionText,
}) {
  const cacheKey = buildCacheKey({
    phash_hi,
    phash_lo,
    dhash_hi,
    dhash_lo,
    bucket16,
    setCode,
    collectorNumber,
  });
  if (memoryState.resultCache.has(cacheKey)) {
    return memoryState.resultCache.get(cacheKey);
  }

  return resolveByFingerprintWithRepository(
    { searchFingerprintCandidatesByBucket: searchFingerprintCandidatesFromMemory },
    {
      phash_hi,
      phash_lo,
      dhash_hi,
      dhash_lo,
      bucket16,
      setCode,
      collectorNumber,
      editionText,
    }
  ).then((result) => {
    cacheResult(cacheKey, result);
    return result;
  });
}
