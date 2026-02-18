import { hammingDistance64 } from './fingerprintCore.mjs';
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
  const normalized = Math.min(1, (phashDistance + dhashDistance) / 24);
  return Math.max(0, 1 - normalized);
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

  if (
    [phash_hi, phash_lo, dhash_hi, dhash_lo, bucket16].some(
      (value) => typeof value !== 'number' || Number.isNaN(value)
    )
  ) {
    return { status: 'none', reason: 'fingerprint_unavailable' };
  }

  const editionHints = extractEditionHintCandidates({ setCode, collectorNumber, editionText });
  const shortlist = await repository.searchFingerprintCandidatesByBucket(bucket16, {
    setCode,
    collectorNumber,
    limit: 120,
    neighborRange: 1,
  });
  if (!shortlist.length) return { status: 'none', reason: 'fingerprint_no_bucket_hits' };

  const scored = shortlist
    .map((row) => {
      const phashDistance = hammingDistance64(phash_hi, phash_lo, row.phash_hi, row.phash_lo);
      const dhashDistance = hammingDistance64(dhash_hi, dhash_lo, row.dhash_hi, row.dhash_lo);
      return {
        ...row,
        phashDistance,
        dhashDistance,
        score: phashDistance + dhashDistance,
      };
    })
    .filter((row) => row.phashDistance <= 8 && row.dhashDistance <= 10)
    .sort((a, b) => a.score - b.score)
    .slice(0, 12);

  if (!scored.length) return { status: 'none', reason: 'fingerprint_threshold_miss' };

  const hinted = applyEditionHintFilter(scored, editionHints);
  const top = hinted[0];
  const second = hinted[1] || null;
  const confidence = computeConfidence(top.phashDistance, top.dhashDistance);

  if (
    hinted.length === 1 &&
    confidence >= 0.93 &&
    top.phashDistance <= 6 &&
    top.dhashDistance <= 8
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
      card: mapCandidateRow(top, top.score),
    };
  }

  if (
    hinted.length >= 1 &&
    confidence >= 0.9 &&
    second &&
    second.score - top.score >= 3 &&
    top.phashDistance <= 7 &&
    top.dhashDistance <= 9
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
      card: mapCandidateRow(top, top.score),
    };
  }

  return {
    status: 'ambiguous',
    matchedBy: 'fingerprint_ambiguous',
    confidence,
    evidence: {
      topScore: top.score,
      secondScore: second?.score ?? null,
    },
    candidates: hinted.map((row) => mapCandidateRow(row, row.score)).slice(0, 8),
  };
}
