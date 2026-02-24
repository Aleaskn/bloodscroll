import { hammingDistance64BigInt, hiLoToHex64 } from './fingerprintCore.mjs';
import { buildSetCollectorCandidates } from './catalogResolverCore.mjs';

function normalizeCollectorNumber(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
  if (!raw) return '';
  const match = raw.match(/^0*([0-9]+)([a-z]?)$/);
  if (!match) return raw;
  return `${Number(match[1])}${match[2]}`;
}

function normalizeSetCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const base = raw.split(/[-_/]/)[0] || raw;
  const compact = base.replace(/[^a-z0-9]/g, '');
  if (compact.length < 2 || compact.length > 6) return '';
  return compact;
}

function mapCandidateRow(row, score) {
  return {
    id: row.card_id || row.id,
    name: row.name,
    set_code: row.set_code ?? null,
    collector_number: row.collector_number ?? null,
    score,
    phashDistance: row.phashDistance,
    dhashDistance: row.dhashDistance,
  };
}

function buildAmbiguousFromRows(rows, confidence, matchedBy, debug, evidence = {}) {
  return {
    status: 'ambiguous',
    matchedBy,
    confidence,
    evidence,
    debug,
    candidates: rows.map((row) => mapCandidateRow(row, row.score)).slice(0, 8),
  };
}

function isLooseSimilarityAcceptable(score) {
  return Number.isFinite(score) && score <= 24;
}

function extractEditionHintCandidates({ setCode, collectorNumber, editionText }) {
  const list = [];
  if (setCode || collectorNumber) {
    list.push({
      setCode: normalizeSetCode(setCode),
      collectorNumber: normalizeCollectorNumber(collectorNumber),
    });
  }
  const fromText = buildSetCollectorCandidates(editionText || '');
  for (const candidate of fromText) {
    list.push({
      setCode: normalizeSetCode(candidate.setCode),
      collectorNumber: normalizeCollectorNumber(candidate.collectorNumber),
    });
  }
  return list.filter((entry) => entry.setCode || entry.collectorNumber);
}

function computeConfidence(phashDistance, dhashDistance) {
  const normalized = Math.min(1, (phashDistance + dhashDistance) / 30);
  return Math.max(0, 1 - normalized);
}

function toUInt32(value) {
  return Number(value) >>> 0;
}

function applyEditionHintFilter(rows, hints) {
  if (!hints.length) return rows;
  const filtered = rows.filter((row) => {
    const rowSet = normalizeSetCode(row.set_code);
    const rowCollector = normalizeCollectorNumber(row.collector_number);
    return hints.some((hint) => {
      if (hint.setCode && hint.collectorNumber) {
        return rowSet === hint.setCode && rowCollector === hint.collectorNumber;
      }
      if (hint.setCode) return rowSet === hint.setCode;
      if (hint.collectorNumber) return rowCollector === hint.collectorNumber;
      return false;
    });
  });
  return filtered.length ? filtered : rows;
}

export async function resolveByFingerprintWithRepository(
  repository,
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
) {
  if (!repository || typeof repository.searchFingerprintCandidatesByBucket !== 'function') {
    throw new Error('Repository missing searchFingerprintCandidatesByBucket');
  }

  const normalizedPhashHi = Number(phash_hi);
  const normalizedPhashLo = Number(phash_lo);
  const normalizedDhashHi = Number(dhash_hi);
  const normalizedDhashLo = Number(dhash_lo);
  const normalizedBucket16 = Number(bucket16);

  if (
    [normalizedPhashHi, normalizedPhashLo, normalizedDhashHi, normalizedDhashLo, normalizedBucket16]
      .some((value) => !Number.isFinite(value))
  ) {
    return {
      status: 'none',
      reason: 'fingerprint_unavailable',
      debug: {
        phash_hi: String(phash_hi ?? ''),
        phash_lo: String(phash_lo ?? ''),
        dhash_hi: String(dhash_hi ?? ''),
        dhash_lo: String(dhash_lo ?? ''),
        bucket16: String(bucket16 ?? ''),
        rawHitsCount: 0,
        minHammingDistance: null,
      },
    };
  }

  const inputPhashHi = toUInt32(normalizedPhashHi);
  const inputPhashLo = toUInt32(normalizedPhashLo);
  const inputDhashHi = toUInt32(normalizedDhashHi);
  const inputDhashLo = toUInt32(normalizedDhashLo);
  const inputBucket16 = toUInt32(normalizedBucket16) & 0xffff;
  const debugBase = {
    phash_hi: String(BigInt(inputPhashHi)),
    phash_lo: String(BigInt(inputPhashLo)),
    dhash_hi: String(BigInt(inputDhashHi)),
    dhash_lo: String(BigInt(inputDhashLo)),
    phash_hex: hiLoToHex64(inputPhashHi, inputPhashLo),
    dhash_hex: hiLoToHex64(inputDhashHi, inputDhashLo),
    bucket16: inputBucket16,
  };

  const editionHints = extractEditionHintCandidates({ setCode, collectorNumber, editionText });
  const shortlist = await repository.searchFingerprintCandidatesByBucket(inputBucket16, {
    setCode,
    collectorNumber,
    limit: 72,
    neighborRange: 1,
  });
  if (!shortlist.length) {
    return {
      status: 'none',
      reason: 'fingerprint_no_bucket_hits',
      debug: {
        ...debugBase,
        rawHitsCount: 0,
        minHammingDistance: null,
      },
    };
  }

  const scoredAll = shortlist
    .map((row) => {
      const rawPhashHi = Number(row.phash_hi);
      const rawPhashLo = Number(row.phash_lo);
      const rawDhashHi = Number(row.dhash_hi);
      const rawDhashLo = Number(row.dhash_lo);
      if (
        [rawPhashHi, rawPhashLo, rawDhashHi, rawDhashLo].some(
          (value) => !Number.isFinite(value)
        )
      ) {
        return null;
      }
      const rowPhashHi = toUInt32(rawPhashHi);
      const rowPhashLo = toUInt32(rawPhashLo);
      const rowDhashHi = toUInt32(rawDhashHi);
      const rowDhashLo = toUInt32(rawDhashLo);

      const phashDistance = hammingDistance64BigInt(inputPhashHi, inputPhashLo, rowPhashHi, rowPhashLo);
      const dhashDistance = hammingDistance64BigInt(inputDhashHi, inputDhashLo, rowDhashHi, rowDhashLo);
      const phashDistanceSwapHiLo = hammingDistance64BigInt(
        inputPhashLo,
        inputPhashHi,
        rowPhashHi,
        rowPhashLo
      );
      const dhashDistanceSwapHiLo = hammingDistance64BigInt(
        inputDhashLo,
        inputDhashHi,
        rowDhashHi,
        rowDhashLo
      );
      return {
        ...row,
        phash_hi: rowPhashHi,
        phash_lo: rowPhashLo,
        dhash_hi: rowDhashHi,
        dhash_lo: rowDhashLo,
        phashDistance,
        dhashDistance,
        phashDistanceSwapHiLo,
        dhashDistanceSwapHiLo,
        score: phashDistance + dhashDistance,
        scoreSwapHiLo: phashDistanceSwapHiLo + dhashDistanceSwapHiLo,
      };
    })
    .filter(Boolean);

  const minHammingDistance =
    scoredAll.length > 0
      ? scoredAll.reduce((min, row) => (row.score < min ? row.score : min), Number.POSITIVE_INFINITY)
      : null;
  const minHammingDistanceSwapHiLo =
    scoredAll.length > 0
      ? scoredAll.reduce(
          (min, row) => (row.scoreSwapHiLo < min ? row.scoreSwapHiLo : min),
          Number.POSITIVE_INFINITY
        )
      : null;

  const scored = scoredAll
    .filter((row) => row.phashDistance <= 10 && row.dhashDistance <= 12)
    .sort((a, b) => a.score - b.score)
    .slice(0, 12);
  const debug = {
    ...debugBase,
    rawHitsCount: shortlist.length,
    minHammingDistance: Number.isFinite(minHammingDistance) ? minHammingDistance : null,
    minHammingDistanceSwapHiLo: Number.isFinite(minHammingDistanceSwapHiLo)
      ? minHammingDistanceSwapHiLo
      : null,
  };

  if (!scored.length) {
    const loose = [...scoredAll].sort((a, b) => a.score - b.score).slice(0, 8);
    if (!loose.length) {
      return {
        status: 'none',
        reason: 'fingerprint_threshold_miss',
        debug,
      };
    }

    const topLoose = loose[0];
    const secondLoose = loose[1] || null;
    if (!isLooseSimilarityAcceptable(topLoose.score)) {
      return {
        status: 'none',
        reason: 'fingerprint_similarity_too_low',
        debug: {
          ...debug,
          topScore: topLoose.score,
          secondScore: secondLoose?.score ?? null,
        },
      };
    }

    return buildAmbiguousFromRows(
      loose,
      0.62,
      'fingerprint_loose_ambiguous',
      {
        ...debug,
        topScore: topLoose.score,
        secondScore: secondLoose?.score ?? null,
      },
      {
        topScore: topLoose.score,
        secondScore: secondLoose?.score ?? null,
      }
    );
  }

  const hinted = applyEditionHintFilter(scored, editionHints);
  const top = hinted[0];
  const second = hinted[1] || null;
  const confidence = computeConfidence(top.phashDistance, top.dhashDistance);
  if (!isLooseSimilarityAcceptable(top.score)) {
    return {
      status: 'none',
      reason: 'fingerprint_similarity_too_low',
      debug: {
        ...debug,
        topScore: top.score,
        secondScore: second?.score ?? null,
      },
    };
  }

  if (
    hinted.length === 1 &&
    confidence >= 0.86 &&
    top.phashDistance <= 10 &&
    top.dhashDistance <= 12
  ) {
    return {
      status: 'matched',
      cardId: top.card_id || top.id,
      matchedBy: 'fingerprint_exact',
      confidence,
      evidence: {
        phashDistance: top.phashDistance,
        dhashDistance: top.dhashDistance,
      },
      debug,
      card: mapCandidateRow(top, top.score),
    };
  }

  if (
    hinted.length >= 1 &&
    confidence >= 0.83 &&
    second &&
    second.score - top.score >= 2 &&
    top.phashDistance <= 12 &&
    top.dhashDistance <= 14
  ) {
    return {
      status: 'matched',
      cardId: top.card_id || top.id,
      matchedBy: 'fingerprint_confident',
      confidence,
      evidence: {
        phashDistance: top.phashDistance,
        dhashDistance: top.dhashDistance,
      },
      debug,
      card: mapCandidateRow(top, top.score),
    };
  }

  if (editionHints.length && hinted.length === 1 && confidence >= 0.82) {
    return {
      status: 'matched',
      cardId: top.card_id || top.id,
      matchedBy: 'fingerprint_with_edition_hint',
      confidence,
      evidence: {
        phashDistance: top.phashDistance,
        dhashDistance: top.dhashDistance,
      },
      debug,
      card: mapCandidateRow(top, top.score),
    };
  }

  return buildAmbiguousFromRows(
    hinted,
    confidence,
    'fingerprint_ambiguous',
    debug,
    {
      topScore: top.score,
      secondScore: second?.score ?? null,
    }
  );
}
