import { createImageFingerprintCandidates } from './imageFingerprint';
import { resolveByFingerprint } from './fingerprintResolver';

const QUAD_CONFIDENCE_GATE = 0.35;

function buildDebugFromFingerprint(fingerprint = {}, extra = {}) {
  return {
    ...(extra || {}),
    variant: fingerprint.variant ?? null,
    blurVariance: fingerprint.blurVariance ?? null,
    quadDetected: fingerprint.quadDetected ?? false,
    quadConfidence: fingerprint.quadConfidence ?? null,
    quadPointsCardNorm: fingerprint.quadPointsCardNorm ?? null,
    edgePointsCardNorm: fingerprint.edgePointsCardNorm ?? null,
    quadBBoxCardNorm: fingerprint.quadBBoxCardNorm ?? null,
    hashPreviewBase64: fingerprint.hashPreviewBase64 || '',
    skipReason: fingerprint.skipReason || extra?.skipReason || '',
  };
}

function pickByMinHammingOrQuad(current, next) {
  if (!next) return current;
  if (!current) return next;
  const currentMin = Number(current?.minHammingDistance ?? Number.POSITIVE_INFINITY);
  const nextMin = Number(next?.minHammingDistance ?? Number.POSITIVE_INFINITY);
  if (nextMin < currentMin) return next;
  if (nextMin > currentMin) return current;

  const currentQuad = Number(current?.quadConfidence ?? 0);
  const nextQuad = Number(next?.quadConfidence ?? 0);
  if (nextQuad > currentQuad) return next;

  return current;
}

function pickByQuadConfidence(current, next) {
  if (!next) return current;
  if (!current) return next;
  const currentQuad = Number(current?.quadConfidence ?? 0);
  const nextQuad = Number(next?.quadConfidence ?? 0);
  if (nextQuad > currentQuad) return next;
  if (nextQuad < currentQuad) return current;

  const currentBlur = Number(current?.blurVariance ?? 0);
  const nextBlur = Number(next?.blurVariance ?? 0);
  if (nextBlur > currentBlur) return next;

  return current;
}

function isHashReady(fingerprint) {
  if (!fingerprint || fingerprint.hashReady === false) return false;
  return [fingerprint.phash_hi, fingerprint.phash_lo, fingerprint.dhash_hi, fingerprint.dhash_lo, fingerprint.bucket16]
    .every((value) => Number.isFinite(Number(value)));
}

function pickTrackingCandidate(current, next) {
  if (!next) return current;
  if (!current) return next;
  const currentQuad = Number(current?.quadConfidence ?? 0);
  const nextQuad = Number(next?.quadConfidence ?? 0);
  if (nextQuad > currentQuad) return next;
  if (nextQuad < currentQuad) return current;

  const currentBlur = Number(current?.blurVariance ?? 0);
  const nextBlur = Number(next?.blurVariance ?? 0);
  if (nextBlur > currentBlur) return next;
  if (nextBlur < currentBlur) return current;

  const currentDetected = current?.quadDetected ? 1 : 0;
  const nextDetected = next?.quadDetected ? 1 : 0;
  if (nextDetected > currentDetected) return next;
  return current;
}

export async function analyzeFrameForQuadTracking(frameMeta = {}) {
  const imageUri = frameMeta.imageUri || '';
  const imageBase64 = typeof frameMeta.imageBase64 === 'string' ? frameMeta.imageBase64 : '';
  const imageWidth = Number(frameMeta.imageWidth ?? 0);
  const imageHeight = Number(frameMeta.imageHeight ?? 0);
  const cardFrame = frameMeta.cardFrame || {};
  const useSyntheticPixels = !!frameMeta.useSyntheticPixels;
  if (!imageUri) return { status: 'none', reason: 'missing_image_uri', debug: null };

  const candidates = await createImageFingerprintCandidates(imageUri, {
    imageBase64,
    imageWidth,
    imageHeight,
    cardFrame,
    regionMode: 'full_card',
    regionFrameInCard: frameMeta.fullCardFrameInCard,
    maxVariants: 1,
    includeDebugPreview: false,
    previewOnlyFirstVariant: true,
    useSyntheticPixels,
    pipelineMode: 'tracking',
  });

  if (!Array.isArray(candidates) || !candidates.length) {
    return {
      status: 'none',
      reason: 'fingerprint_unavailable',
      debug: null,
    };
  }

  let best = null;
  for (const fingerprint of candidates) {
    best = pickTrackingCandidate(best, fingerprint);
  }
  if (!best) {
    return {
      status: 'none',
      reason: 'fingerprint_unavailable',
      debug: null,
    };
  }

  const debug = buildDebugFromFingerprint(best, { quadGate: QUAD_CONFIDENCE_GATE });
  if (best.skipReason === 'blur_too_low') {
    return { status: 'none', reason: 'blur_too_low', debug };
  }
  if (!best.quadDetected) {
    return { status: 'none', reason: 'quad_not_detected', debug };
  }
  if (Number(best.quadConfidence ?? 0) < QUAD_CONFIDENCE_GATE) {
    return { status: 'none', reason: 'quad_confidence_low', debug };
  }
  return { status: 'ready', reason: 'quad_ready', debug };
}

export async function processFrameAndResolveCard(frameMeta = {}) {
  const imageUri = frameMeta.imageUri || '';
  const cardFrame = frameMeta.cardFrame || {};
  const useSyntheticPixels = !!frameMeta.useSyntheticPixels;
  const maxVariantsPrimary = Number(frameMeta.maxVariantsPrimary ?? 1) || 1;
  const maxVariantsExtended = Number(frameMeta.maxVariantsExtended ?? 5) || 5;
  const enableExtendedPass = !!frameMeta.enableExtendedPass;
  const includeDebugPreview = !!frameMeta.includeDebugPreview;

  if (!imageUri) return { status: 'none', reason: 'missing_image_uri' };

  let bestMatched = null;
  let bestAmbiguous = null;
  let bestResolverNoneDebug = null;
  let bestQuadGateDebug = null;
  let bestPreprocessDebug = null;

  const runFingerprintPass = async (maxVariants) => {
    const fingerprintCandidates = await createImageFingerprintCandidates(imageUri, {
      cardFrame,
      regionMode: 'full_card',
      regionFrameInCard: frameMeta.fullCardFrameInCard,
      maxVariants,
      includeDebugPreview,
      previewOnlyFirstVariant: true,
      useSyntheticPixels,
      pipelineMode: 'hash',
    });
    if (!Array.isArray(fingerprintCandidates) || !fingerprintCandidates.length) return;

    for (const fingerprint of fingerprintCandidates) {
      const baseDebug = buildDebugFromFingerprint(fingerprint);
      if (!isHashReady(fingerprint)) {
        bestPreprocessDebug = pickByQuadConfidence(
          bestPreprocessDebug,
          {
            ...baseDebug,
            skipReason: baseDebug.skipReason || 'fingerprint_not_ready',
          }
        );
        continue;
      }

      const quadConfidence = Number(fingerprint.quadConfidence ?? 0);
      const quadDetected = !!fingerprint.quadDetected;
      if (!quadDetected || quadConfidence < QUAD_CONFIDENCE_GATE) {
        bestQuadGateDebug = pickByQuadConfidence(
          bestQuadGateDebug,
          {
            ...baseDebug,
            skipReason: 'quad_confidence_low',
            quadGate: QUAD_CONFIDENCE_GATE,
          }
        );
        continue;
      }

      const fingerprintResult = await resolveByFingerprint({
        phash_hi: fingerprint.phash_hi,
        phash_lo: fingerprint.phash_lo,
        dhash_hi: fingerprint.dhash_hi,
        dhash_lo: fingerprint.dhash_lo,
        bucket16: fingerprint.bucket16,
      });

      if (fingerprintResult.status === 'matched') {
        const withDebug = {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            source: 'fingerprint',
            variant: fingerprint.variant ?? null,
          },
          debug: {
            ...(fingerprintResult.debug || {}),
            ...baseDebug,
          },
        };
        if (!bestMatched || Number(withDebug.confidence ?? 0) > Number(bestMatched?.confidence ?? 0)) {
          bestMatched = withDebug;
        }
        continue;
      }

      if (fingerprintResult.status === 'ambiguous' && Array.isArray(fingerprintResult.candidates)) {
        if (!fingerprintResult.candidates.length) continue;
        const candidateAmbiguous = {
          ...fingerprintResult,
          evidence: {
            ...(fingerprintResult.evidence || {}),
            source: 'fingerprint',
            variant: fingerprint.variant ?? null,
          },
          debug: {
            ...(fingerprintResult.debug || {}),
            ...baseDebug,
          },
        };

        if (!bestAmbiguous) {
          bestAmbiguous = candidateAmbiguous;
        } else {
          bestAmbiguous = pickByMinHammingOrQuad(bestAmbiguous, candidateAmbiguous);
        }
        continue;
      }

      if (fingerprintResult.status === 'none') {
        const candidateNoneDebug = {
          ...(fingerprintResult.debug || {}),
          ...baseDebug,
        };
        bestResolverNoneDebug = pickByMinHammingOrQuad(bestResolverNoneDebug, candidateNoneDebug);
      }
    }
  };

  await runFingerprintPass(maxVariantsPrimary);
  if (enableExtendedPass && !bestMatched && !bestAmbiguous) {
    await runFingerprintPass(maxVariantsExtended);
  }

  if (bestMatched) return bestMatched;
  if (bestAmbiguous) return bestAmbiguous;

  if (bestResolverNoneDebug) {
    return {
      status: 'none',
      reason: 'fingerprint_no_confident_match',
      debug: bestResolverNoneDebug,
    };
  }

  if (bestQuadGateDebug) {
    return {
      status: 'none',
      reason: 'quad_confidence_low',
      debug: bestQuadGateDebug,
    };
  }

  if (bestPreprocessDebug) {
    return {
      status: 'none',
      reason: bestPreprocessDebug.skipReason || 'fingerprint_not_ready',
      debug: bestPreprocessDebug,
    };
  }

  return {
    status: 'none',
    reason: 'fingerprint_unavailable',
    debug: null,
  };
}
