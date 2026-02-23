import { buildSetCollectorCandidates, resolveLocalScannedCard } from './catalogResolver';
import {
  extractCardTextOnDevice,
  extractCardTitleTextOnDevice,
  extractEditionTextOnDevice,
} from './ocrOnDevice';
import { createImageFingerprintCandidates } from './imageFingerprint';
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

function reconcileWithFingerprintAmbiguous(result, fingerprintAmbiguous, titleText, editionText, sourceLabel) {
  if (!result || result.status === 'none') return null;
  if (result.status === 'matched') {
    if (!fingerprintAmbiguous) {
      return {
        ...result,
        evidence: {
          source: sourceLabel,
          titleText,
          editionText,
        },
        debug: fingerprintAmbiguous?.debug || null,
      };
    }

    const fingerprintHasOcrCard = fingerprintAmbiguous.candidates?.some(
      (entry) => String(entry.id) === String(result.cardId)
    );

    if (fingerprintHasOcrCard) {
      return {
        ...result,
        matchedBy: 'fingerprint_ocr_consensus',
        confidence: Math.max(Number(result.confidence ?? 0.8), Number(fingerprintAmbiguous.confidence ?? 0.8)),
        evidence: {
          source: 'fingerprint_ocr_consensus',
          titleText,
          editionText,
        },
        debug: fingerprintAmbiguous?.debug || null,
      };
    }

    return {
      ...fingerprintAmbiguous,
      matchedBy: 'fingerprint_ocr_conflict',
      debug: fingerprintAmbiguous?.debug || null,
    };
  }

  if (result.status === 'ambiguous') {
    if (!fingerprintAmbiguous) {
      return {
        ...result,
        evidence: {
          source: sourceLabel,
          titleText,
          editionText,
        },
        debug: fingerprintAmbiguous?.debug || null,
      };
    }

    return {
      status: 'ambiguous',
      matchedBy: 'fingerprint_ocr_ambiguous',
      confidence: Math.max(Number(fingerprintAmbiguous.confidence ?? 0.6), Number(result.confidence ?? 0.6)),
      candidates: mergeAmbiguousCandidates(fingerprintAmbiguous.candidates || [], result.candidates || []).slice(0, 12),
      evidence: {
        source: 'fingerprint_ocr_ambiguous',
        titleText,
        editionText,
      },
      debug: fingerprintAmbiguous?.debug || null,
    };
  }

  return null;
}

export async function processFrameAndResolveCard(frameMeta = {}) {
  const imageUri = frameMeta.imageUri || '';
  const cardFrame = frameMeta.cardFrame || {};
  const editionFrameInCard = frameMeta.editionFrameInCard || {};
  const enableMultilingualFallback = !!frameMeta.enableMultilingualFallback;
  const allowOcrFallback = !!frameMeta.allowOcrFallback;
  const skipEditionOcrInPrimary = !!frameMeta.skipEditionOcrInPrimary;

  if (!imageUri) return { status: 'none', reason: 'missing_image_uri' };

  // 1) Optional edition-first path (disabled for hash-only debug mode).
  const editionText = skipEditionOcrInPrimary
    ? ''
    : await extractEditionTextOnDevice(imageUri, {
        cardFrame,
        editionFrameInCard,
      });
  const footerHint = extractFooterHint(editionText);

  if (!skipEditionOcrInPrimary && footerHint.setCode && footerHint.collectorNumber) {
    const editionOnlyResult = await resolveLocalScannedCard({ cardText: '', editionText });
    if (editionOnlyResult.status === 'matched') {
      return {
        ...editionOnlyResult,
        confidence: Math.max(Number(editionOnlyResult.confidence ?? 0.9), 0.95),
        matchedBy: 'set_collector_exact',
        evidence: {
          source: 'edition_fast_path',
          editionText,
        },
      };
    }
  }

  // 2) Fingerprint-first resolution.
  let fingerprintAmbiguous = null;
  let bestFingerprintNoneDebug = null;
  const fingerprintCandidates = await createImageFingerprintCandidates(imageUri, {
    cardFrame,
    regionMode: 'full_card',
    regionFrameInCard: frameMeta.fullCardFrameInCard,
    maxVariants: 5,
    includeDebugPreview: true,
  });

  if (Array.isArray(fingerprintCandidates) && fingerprintCandidates.length) {
    let bestMatched = null;
    for (const fingerprint of fingerprintCandidates) {
      const fingerprintResult = await resolveByFingerprint({
        ...fingerprint,
        setCode: footerHint.setCode,
        collectorNumber: footerHint.collectorNumber,
        editionText,
      });

      if (fingerprintResult.status === 'matched') {
        const withDebug = {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            source: 'fingerprint',
            editionText,
            variant: fingerprint.variant ?? null,
          },
          debug: {
            ...(fingerprintResult.debug || {}),
            variant: fingerprint.variant ?? null,
            hashPreviewBase64: fingerprint.hashPreviewBase64 || '',
          },
        };
        if (!bestMatched || Number(withDebug.confidence ?? 0) > Number(bestMatched.confidence ?? 0)) {
          bestMatched = withDebug;
        }
        continue;
      }

      if (fingerprintResult.status === 'ambiguous' && Array.isArray(fingerprintResult.candidates)) {
        if (!fingerprintResult.candidates.length) {
          continue;
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
              variant: fingerprint.variant ?? null,
            },
            debug: {
              ...(fingerprintResult.debug || {}),
              variant: fingerprint.variant ?? null,
              hashPreviewBase64: fingerprint.hashPreviewBase64 || '',
            },
          };
        }

        const candidateAmbiguous = {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            source: 'fingerprint',
            editionText,
            variant: fingerprint.variant ?? null,
          },
          debug: {
            ...(fingerprintResult.debug || {}),
            variant: fingerprint.variant ?? null,
            hashPreviewBase64: fingerprint.hashPreviewBase64 || '',
          },
        };

        if (!fingerprintAmbiguous) {
          fingerprintAmbiguous = candidateAmbiguous;
        } else {
          const prev = Number(fingerprintAmbiguous?.debug?.minHammingDistance ?? Number.POSITIVE_INFINITY);
          const next = Number(candidateAmbiguous?.debug?.minHammingDistance ?? Number.POSITIVE_INFINITY);
          if (next < prev) {
            fingerprintAmbiguous = candidateAmbiguous;
          }
        }
      }

      if (fingerprintResult.status === 'none') {
        const candidateNoneDebug = {
          ...(fingerprintResult.debug || {}),
          variant: fingerprint.variant ?? null,
          hashPreviewBase64: fingerprint.hashPreviewBase64 || '',
        };
        if (!bestFingerprintNoneDebug) {
          bestFingerprintNoneDebug = candidateNoneDebug;
        } else {
          const prev = Number(bestFingerprintNoneDebug.minHammingDistance ?? Number.POSITIVE_INFINITY);
          const next = Number(candidateNoneDebug.minHammingDistance ?? Number.POSITIVE_INFINITY);
          if (next < prev) {
            bestFingerprintNoneDebug = candidateNoneDebug;
          }
        }
      }
    }

    if (bestMatched) return bestMatched;
    if (fingerprintAmbiguous && !allowOcrFallback) return fingerprintAmbiguous;
  }

  if (!allowOcrFallback) {
    return {
      status: 'none',
      reason: 'fingerprint_no_confident_match',
      debug: fingerprintAmbiguous?.debug || bestFingerprintNoneDebug || null,
    };
  }

  // 3) OCR fallback - title only first.
  const titleText = await extractCardTitleTextOnDevice(imageUri, {
    cardFrame,
    enableMultilingualFallback,
  });

  if (titleText || editionText) {
    const titleResult = await resolveLocalScannedCard({
      cardText: titleText || '',
      editionText,
    });
    const reconciledTitle = reconcileWithFingerprintAmbiguous(
      titleResult,
      fingerprintAmbiguous,
      titleText,
      editionText,
      'ocr_title_fallback'
    );
    if (reconciledTitle) return reconciledTitle;
  }

  // 4) OCR fallback - full card text as last chance only.
  const cardText = await extractCardTextOnDevice(imageUri, {
    cardFrame,
  });
  if (cardText || titleText || editionText) {
    const fullResult = await resolveLocalScannedCard({
      cardText: [titleText, cardText].filter(Boolean).join('\n'),
      editionText,
    });
    const reconciledFull = reconcileWithFingerprintAmbiguous(
      fullResult,
      fingerprintAmbiguous,
      titleText,
      editionText,
      'ocr_full_fallback'
    );
    if (reconciledFull) return reconciledFull;
  }

  if (fingerprintAmbiguous) return fingerprintAmbiguous;

  return {
    status: 'none',
    reason: 'no_confident_match',
    debug: bestFingerprintNoneDebug || null,
  };
}
