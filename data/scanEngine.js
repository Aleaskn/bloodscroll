import { buildSetCollectorCandidates, resolveLocalScannedCard } from './catalogResolver';
import {
  extractCardTextOnDevice,
  extractCardTitleTextOnDevice,
  extractEditionTextOnDevice,
} from './ocrOnDevice';
import { createImageFingerprint } from './imageFingerprint';
import { resolveByFingerprint } from './fingerprintResolver';

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

function extractFooterHint(editionText) {
  const candidates = buildSetCollectorCandidates(editionText || '');
  if (!candidates.length) return { setCode: '', collectorNumber: '' };
  return {
    setCode: candidates[0].setCode || '',
    collectorNumber: candidates[0].collectorNumber || '',
  };
}

function normalizeScanResult(result, fallbackReason = 'none') {
  if (!result || typeof result !== 'object') return { status: 'none', reason: fallbackReason };
  if (result.status === 'matched') return result;
  if (result.status === 'ambiguous') return result;
  return { status: 'none', reason: fallbackReason };
}

function disambiguateCandidatesByEdition(candidates, footerHint, editionText) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const editionCandidates = buildSetCollectorCandidates(editionText || '');
  const hints = [
    {
      setCode: normalizeSetCode(footerHint?.setCode),
      collectorNumber: normalizeCollectorNumber(footerHint?.collectorNumber),
    },
    ...editionCandidates.map((entry) => ({
      setCode: normalizeSetCode(entry.setCode),
      collectorNumber: normalizeCollectorNumber(entry.collectorNumber),
    })),
  ].filter((entry) => entry.setCode || entry.collectorNumber);

  if (!hints.length) return null;
  const filtered = candidates.filter((candidate) => {
    const setCode = normalizeSetCode(candidate?.set_code);
    const collectorNumber = normalizeCollectorNumber(candidate?.collector_number);
    return hints.some((hint) => {
      if (hint.setCode && hint.collectorNumber) {
        return setCode === hint.setCode && collectorNumber === hint.collectorNumber;
      }
      if (hint.setCode) return setCode === hint.setCode;
      if (hint.collectorNumber) return collectorNumber === hint.collectorNumber;
      return false;
    });
  });

  return filtered.length === 1 ? filtered[0] : null;
}

function mergeAmbiguousCandidates(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const candidate of [...primary, ...secondary]) {
    if (!candidate?.id) continue;
    const key = String(candidate.id);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

export async function processFrameAndResolveCard(frameMeta = {}) {
  const imageUri = frameMeta.imageUri || '';
  const cardFrame = frameMeta.cardFrame || {};
  const editionFrameInCard = frameMeta.editionFrameInCard || {};
  const enableMultilingualFallback = !!frameMeta.enableMultilingualFallback;

  if (!imageUri) return { status: 'none', reason: 'missing_image_uri' };

  const editionText = await extractEditionTextOnDevice(imageUri, {
    cardFrame,
    editionFrameInCard,
  });
  const footerHint = extractFooterHint(editionText);
  let fingerprintAmbiguous = null;

  const fingerprint = await createImageFingerprint(imageUri, {
    cardFrame,
    artworkFrameInCard: frameMeta.artworkFrameInCard,
  });

  if (fingerprint) {
    const fingerprintResult = await resolveByFingerprint({
      ...fingerprint,
      setCode: footerHint.setCode,
      collectorNumber: footerHint.collectorNumber,
      editionText,
    });

    if (fingerprintResult.status === 'matched') {
      return normalizeScanResult(
        {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            editionText,
            source: 'fingerprint',
          },
        },
        'fingerprint_no_match'
      );
    }

    if (fingerprintResult.status === 'ambiguous' && Array.isArray(fingerprintResult.candidates)) {
      if (!fingerprintResult.candidates.length) {
        return { status: 'none', reason: 'fingerprint_ambiguous_empty' };
      }
      const editionResolved = disambiguateCandidatesByEdition(
        fingerprintResult.candidates,
        footerHint,
        editionText
      );
      if (editionResolved) {
        return {
          status: 'matched',
          cardId: String(editionResolved.id),
          matchedBy: 'fingerprint_ambiguous_resolved_by_edition',
          confidence: Math.max(0.9, Number(fingerprintResult.confidence ?? 0.85)),
          card: editionResolved,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            source: 'fingerprint',
            editionText,
          },
        };
      }

      fingerprintAmbiguous = normalizeScanResult(
        {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            editionText,
            source: 'fingerprint',
          },
        },
        'fingerprint_ambiguous'
      );
    }
  }

  const [titleText, cardText] = await Promise.all([
    extractCardTitleTextOnDevice(imageUri, {
      cardFrame,
      enableMultilingualFallback,
    }),
    extractCardTextOnDevice(imageUri, {
      cardFrame,
    }),
  ]);

  const mergedCardText = [titleText, cardText].filter(Boolean).join('\n');
  if (!mergedCardText && !editionText) return { status: 'none', reason: 'ocr_empty' };

  const ocrResult = await resolveLocalScannedCard({
    cardText: mergedCardText,
    editionText,
  });

  if (ocrResult.status === 'matched') {
    if (fingerprintAmbiguous?.status === 'ambiguous') {
      const fingerprintHasOcrCard = fingerprintAmbiguous.candidates?.some(
        (entry) => String(entry.id) === String(ocrResult.cardId)
      );
      if (fingerprintHasOcrCard) {
        return {
          ...ocrResult,
          matchedBy: 'fingerprint_ocr_consensus',
          confidence: Math.max(Number(ocrResult.confidence ?? 0.8), Number(fingerprintAmbiguous.confidence ?? 0.8)),
          evidence: {
            source: 'fingerprint_ocr_consensus',
            titleText,
            editionText,
          },
        };
      }
      return {
        ...fingerprintAmbiguous,
        matchedBy: 'fingerprint_ocr_conflict',
      };
    }
    return {
      ...ocrResult,
      evidence: {
        source: 'ocr_fallback',
        titleText,
        editionText,
      },
    };
  }
  if (ocrResult.status === 'ambiguous') {
    if (fingerprintAmbiguous?.status === 'ambiguous') {
      const mergedCandidates = mergeAmbiguousCandidates(
        fingerprintAmbiguous.candidates || [],
        ocrResult.candidates || []
      );
      return {
        status: 'ambiguous',
        matchedBy: 'fingerprint_ocr_ambiguous',
        confidence: Math.max(
          Number(fingerprintAmbiguous.confidence ?? 0.6),
          Number(ocrResult.confidence ?? 0.6)
        ),
        candidates: mergedCandidates.slice(0, 12),
        evidence: {
          source: 'fingerprint_ocr_ambiguous',
          titleText,
          editionText,
        },
      };
    }
    return {
      ...ocrResult,
      evidence: {
        source: 'ocr_fallback',
        titleText,
        editionText,
      },
    };
  }

  if (fingerprintAmbiguous?.status === 'ambiguous') {
    return fingerprintAmbiguous;
  }

  return {
    status: 'none',
    reason: 'no_confident_match',
  };
}
