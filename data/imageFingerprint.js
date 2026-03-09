import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import {
  computeDHash64FromGrayscale,
  computePHash64FromGrayscale,
  deriveBucket16FromHi,
  preprocessGrayscaleForHash,
  resizeGrayscaleNearest,
  rgbaToGrayscale,
  splitHex64ToHiLo,
} from './fingerprintCore.mjs';
import {
  buildSobelEdgeAnalysis,
  computeLaplacianVariance,
  computeQuadBoundingBox,
  detectCardQuadFromEdges,
  normalizeQuadPoints,
} from './quadDetectionCore.mjs';
import {
  HASH_D_HEIGHT,
  HASH_D_WIDTH,
  HASH_DEBUG_FORCE_FIXED,
  HASH_P_SIZE,
  HASH_WARP_SIZE,
  MTG_CARD_ASPECT_RATIO,
} from './hashConfig';

let jpegModulePromise = null;
let bufferPolyfillPromise = null;
const DETECT_PROFILE_TRACKING = Object.freeze({
  minWidth: 320,
  minHeight: 240,
  maxLongSide: 480,
});
const DETECT_PROFILE_HASH = Object.freeze({
  minWidth: 640,
  minHeight: 480,
  maxLongSide: 960,
});
const BLUR_MIN_LAPLACIAN_VARIANCE = 8;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const map = Object.create(null);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    map[BASE64_ALPHABET[i]] = i;
  }
  return map;
})();

async function getJpegModule() {
  await ensureBufferPolyfill();
  if (jpegModulePromise) return jpegModulePromise;
  jpegModulePromise = import('jpeg-js')
    .then((module) => module?.default ?? module)
    .catch(() => null);
  return jpegModulePromise;
}

async function ensureBufferPolyfill() {
  if (typeof globalThis !== 'undefined' && globalThis.Buffer) return true;
  if (bufferPolyfillPromise) return bufferPolyfillPromise;
  bufferPolyfillPromise = import('buffer')
    .then((module) => {
      const BufferCtor = module?.Buffer ?? module?.default?.Buffer ?? module?.default;
      if (BufferCtor && typeof globalThis !== 'undefined') {
        globalThis.Buffer = BufferCtor;
        return true;
      }
      return false;
    })
    .catch(() => false);
  return bufferPolyfillPromise;
}

function bytesToBase64(bytes) {
  if (!bytes || !bytes.length) return '';
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triplet >> 18) & 63];
    out += BASE64_ALPHABET[(triplet >> 12) & 63];
    out += i + 1 < len ? BASE64_ALPHABET[(triplet >> 6) & 63] : '=';
    out += i + 2 < len ? BASE64_ALPHABET[triplet & 63] : '=';
  }
  return out;
}

function base64ToBytes(base64) {
  const clean = String(base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return new Uint8Array(0);
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(Math.max(0, outLen));
  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_LOOKUP[clean[i]] ?? 0;
    const c1 = BASE64_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = clean[i + 2] === '=' ? 0 : BASE64_LOOKUP[clean[i + 2]] ?? 0;
    const c3 = clean[i + 3] === '=' ? 0 : BASE64_LOOKUP[clean[i + 3]] ?? 0;
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIndex < out.length) out[outIndex++] = (triplet >> 16) & 255;
    if (outIndex < out.length && clean[i + 2] !== '=') out[outIndex++] = (triplet >> 8) & 255;
    if (outIndex < out.length && clean[i + 3] !== '=') out[outIndex++] = triplet & 255;
  }
  return out;
}

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function buildBase64Preview(imageUri, actions) {
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [...actions],
    {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );
  return {
    uri: result?.uri ?? null,
    base64: result?.base64 ?? '',
  };
}

function grayscaleToRgba(gray, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  return rgba;
}

async function encodeDebugPreviewBase64(gray32) {
  const jpeg = await getJpegModule();
  if (!jpeg || typeof jpeg.encode !== 'function') return '';
  const rgba = grayscaleToRgba(gray32, HASH_P_SIZE, HASH_P_SIZE);
  const encoded = jpeg.encode({ data: rgba, width: HASH_P_SIZE, height: HASH_P_SIZE }, 80);
  if (!encoded?.data) return '';
  return bytesToBase64(encoded.data instanceof Uint8Array ? encoded.data : new Uint8Array(encoded.data));
}

async function decodeJpegBase64(base64) {
  if (!base64) return null;
  const jpeg = await getJpegModule();
  if (!jpeg) return null;
  const bytes = base64ToBytes(base64);
  const decoded = jpeg.decode(bytes, { useTArray: true });
  if (!decoded?.width || !decoded?.height || !decoded?.data) return null;
  return decoded;
}

function resolveCardFrame(cardFrame = {}) {
  return {
    left: clamp01(cardFrame.left, 0),
    top: clamp01(cardFrame.top, 0),
    width: clamp01(cardFrame.width, 1),
    height: clamp01(cardFrame.height, 1),
    aspectRatio: Number(cardFrame.aspectRatio) > 0 ? Number(cardFrame.aspectRatio) : 0,
  };
}

function clampRegionFrame(frame) {
  const widthInCard = Math.min(0.96, Math.max(0.3, clamp01(frame.widthInCard, 0.84)));
  const heightInCard = Math.min(0.8, Math.max(0.2, clamp01(frame.heightInCard, 0.46)));
  const leftInCard = Math.min(1 - widthInCard, Math.max(0, clamp01(frame.leftInCard, 0.08)));
  const topInCard = Math.min(1 - heightInCard, Math.max(0, clamp01(frame.topInCard, 0.18)));
  return { leftInCard, topInCard, widthInCard, heightInCard };
}

function clampFullCardRegionFrame(frame) {
  const widthInCard = Math.min(0.99, Math.max(0.6, clamp01(frame.widthInCard, 0.96)));
  const heightInCard = Math.min(0.99, Math.max(0.6, clamp01(frame.heightInCard, 0.96)));
  const leftInCard = Math.min(1 - widthInCard, Math.max(0, clamp01(frame.leftInCard, 0.02)));
  const topInCard = Math.min(1 - heightInCard, Math.max(0, clamp01(frame.topInCard, 0.02)));
  return { leftInCard, topInCard, widthInCard, heightInCard };
}

function resolveHashRegionFrame(regionFrameInCard = {}, regionMode = 'full_card') {
  if (regionMode === 'full_card') {
    return {
      leftInCard: clamp01(regionFrameInCard.leftInCard, 0.02),
      topInCard: clamp01(regionFrameInCard.topInCard, 0.02),
      widthInCard: clamp01(regionFrameInCard.widthInCard, 0.96),
      heightInCard: clamp01(regionFrameInCard.heightInCard, 0.96),
    };
  }
  return {
    leftInCard: clamp01(regionFrameInCard.leftInCard, 0.08),
    topInCard: clamp01(regionFrameInCard.topInCard, 0.18),
    widthInCard: clamp01(regionFrameInCard.widthInCard, 0.84),
    heightInCard: clamp01(regionFrameInCard.heightInCard, 0.46),
  };
}

function buildRegionVariants(baseFrame, maxVariants = 5, regionMode = 'full_card') {
  const seeds = [
    { dx: 0, dy: 0, scale: 1, tag: 'base' },
    { dx: -0.04, dy: 0, scale: 1, tag: 'left' },
    { dx: 0.04, dy: 0, scale: 1, tag: 'right' },
    { dx: 0, dy: -0.04, scale: 1, tag: 'up' },
    { dx: 0, dy: 0.04, scale: 1, tag: 'down' },
    { dx: 0, dy: 0, scale: regionMode === 'full_card' ? 0.98 : 0.92, tag: 'tight' },
    { dx: 0, dy: 0, scale: regionMode === 'full_card' ? 1.02 : 1.08, tag: 'wide' },
  ];

  return seeds.slice(0, Math.max(1, maxVariants)).map((seed, index) => {
    const width = baseFrame.widthInCard * seed.scale;
    const height = baseFrame.heightInCard * seed.scale;
    const clamped =
      regionMode === 'full_card'
        ? clampFullCardRegionFrame({
            leftInCard: baseFrame.leftInCard + seed.dx - (width - baseFrame.widthInCard) / 2,
            topInCard: baseFrame.topInCard + seed.dy - (height - baseFrame.heightInCard) / 2,
            widthInCard: width,
            heightInCard: height,
          })
        : clampRegionFrame({
            leftInCard: baseFrame.leftInCard + seed.dx - (width - baseFrame.widthInCard) / 2,
            topInCard: baseFrame.topInCard + seed.dy - (height - baseFrame.heightInCard) / 2,
            widthInCard: width,
            heightInCard: height,
          });
    return {
      frame: clamped,
      tag: seed.tag,
      index,
    };
  });
}

function buildCardCropAction(cardFrame, imageSize) {
  const imageWidth = Number(imageSize?.width || 0);
  const imageHeight = Number(imageSize?.height || 0);
  if (!imageWidth || !imageHeight) return null;

  const left = clamp01(cardFrame.left, 0);
  const top = clamp01(cardFrame.top, 0);
  const widthRatio = clamp01(cardFrame.width, 1);
  let heightRatio = clamp01(cardFrame.height, 1);
  const enforcedAspectRatio = MTG_CARD_ASPECT_RATIO;
  if (!heightRatio) {
    heightRatio = (widthRatio * imageWidth) / (enforcedAspectRatio * imageHeight);
  }

  const originX = Math.max(0, Math.round(imageWidth * left));
  const originY = Math.max(0, Math.round(imageHeight * top));
  const width = Math.max(1, Math.min(Math.round(imageWidth * widthRatio), imageWidth - originX));
  const height = Math.max(1, Math.min(Math.round(imageHeight * heightRatio), imageHeight - originY));

  return { crop: { originX, originY, width, height } };
}

function buildArtworkCropAction(artworkFrame, cardWidth, cardHeight) {
  const safeLeft = clamp01(artworkFrame.leftInCard, 0);
  const safeTop = clamp01(artworkFrame.topInCard, 0);
  const safeWidth = clamp01(artworkFrame.widthInCard, 1);
  const safeHeight = clamp01(artworkFrame.heightInCard, 1);
  const originX = Math.max(0, Math.min(cardWidth - 1, Math.round(cardWidth * safeLeft)));
  const originY = Math.max(0, Math.min(cardHeight - 1, Math.round(cardHeight * safeTop)));
  const maxWidth = Math.max(1, cardWidth - originX);
  const maxHeight = Math.max(1, cardHeight - originY);
  const width = Math.max(1, Math.min(Math.round(cardWidth * safeWidth), maxWidth));
  const height = Math.max(1, Math.min(Math.round(cardHeight * safeHeight), maxHeight));
  return { crop: { originX, originY, width, height } };
}

function resolveDetectResize(srcWidth, srcHeight, detectProfile = DETECT_PROFILE_HASH) {
  const width = Math.max(1, Number(srcWidth) || 1);
  const height = Math.max(1, Number(srcHeight) || 1);
  const minWidth = Math.max(1, Number(detectProfile?.minWidth) || DETECT_PROFILE_HASH.minWidth);
  const minHeight = Math.max(1, Number(detectProfile?.minHeight) || DETECT_PROFILE_HASH.minHeight);
  const maxLongSide = Math.max(
    Math.max(minWidth, minHeight),
    Number(detectProfile?.maxLongSide) || DETECT_PROFILE_HASH.maxLongSide
  );

  let scale = Math.max(
    minWidth / width,
    minHeight / height,
    1
  );
  let outWidth = Math.round(width * scale);
  let outHeight = Math.round(height * scale);

  const longSide = Math.max(outWidth, outHeight);
  if (longSide > maxLongSide) {
    const capScale = maxLongSide / longSide;
    outWidth = Math.max(1, Math.round(outWidth * capScale));
    outHeight = Math.max(1, Math.round(outHeight * capScale));
  }

  if (outWidth < minWidth || outHeight < minHeight) {
    scale = Math.max(
      minWidth / Math.max(1, outWidth),
      minHeight / Math.max(1, outHeight)
    );
    outWidth = Math.max(1, Math.round(outWidth * scale));
    outHeight = Math.max(1, Math.round(outHeight * scale));
  }

  return { width: outWidth, height: outHeight };
}

function normalizeEdgePoints(points, width, height, maxPoints = 220) {
  if (!Array.isArray(points) || !points.length) return [];
  const normW = Math.max(1, Number(width) - 1);
  const normH = Math.max(1, Number(height) - 1);
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const normalized = [];
  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    normalized.push({
      x: clamp01(Number(point?.x ?? 0) / normW, 0),
      y: clamp01(Number(point?.y ?? 0) / normH, 0),
    });
    if (normalized.length >= maxPoints) break;
  }
  return normalized;
}

function cropGrayscale(gray, width, height, cropRect) {
  const crop = cropRect || {};
  const originX = Math.max(0, Math.min(width - 1, Math.round(Number(crop.originX ?? 0))));
  const originY = Math.max(0, Math.min(height - 1, Math.round(Number(crop.originY ?? 0))));
  const maxWidth = Math.max(1, width - originX);
  const maxHeight = Math.max(1, height - originY);
  const outWidth = Math.max(1, Math.min(maxWidth, Math.round(Number(crop.width ?? maxWidth))));
  const outHeight = Math.max(1, Math.min(maxHeight, Math.round(Number(crop.height ?? maxHeight))));
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const srcRow = (originY + y) * width;
    const dstRow = y * outWidth;
    for (let x = 0; x < outWidth; x += 1) {
      out[dstRow + x] = gray[srcRow + originX + x];
    }
  }
  return {
    gray: out,
    width: outWidth,
    height: outHeight,
  };
}

async function getImageSize(imageUri) {
  return new Promise((resolve, reject) => {
    Image.getSize(
      imageUri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}

function sampleBilinear(gray, width, height, x, y) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = clampedX - x0;
  const dy = clampedY - y0;
  const p00 = gray[y0 * width + x0];
  const p10 = gray[y0 * width + x1];
  const p01 = gray[y1 * width + x0];
  const p11 = gray[y1 * width + x1];
  const top = p00 * (1 - dx) + p10 * dx;
  const bottom = p01 * (1 - dx) + p11 * dx;
  return top * (1 - dy) + bottom * dy;
}

function warpQuadToSquare(gray, srcWidth, srcHeight, quad, dstSize) {
  const [tl, tr, br, bl] = quad;
  const out = new Uint8Array(dstSize * dstSize);
  for (let y = 0; y < dstSize; y += 1) {
    const v = dstSize <= 1 ? 0 : y / (dstSize - 1);
    for (let x = 0; x < dstSize; x += 1) {
      const u = dstSize <= 1 ? 0 : x / (dstSize - 1);
      const srcX =
        (1 - u) * (1 - v) * tl.x +
        u * (1 - v) * tr.x +
        u * v * br.x +
        (1 - u) * v * bl.x;
      const srcY =
        (1 - u) * (1 - v) * tl.y +
        u * (1 - v) * tr.y +
        u * v * br.y +
        (1 - u) * v * bl.y;
      out[y * dstSize + x] = Math.round(sampleBilinear(gray, srcWidth, srcHeight, srcX, srcY));
    }
  }
  return out;
}

export async function createImageFingerprint(imageUri, options = {}) {
  const fingerprints = await createImageFingerprintCandidates(imageUri, { ...options, maxVariants: 1 });
  return fingerprints[0] || null;
}

export async function createImageFingerprintCandidates(imageUri, options = {}) {
  if (!imageUri) return [];
  const pipelineMode = options.pipelineMode === 'tracking' ? 'tracking' : 'hash';
  const isTrackingMode = pipelineMode === 'tracking';
  const detectProfile = isTrackingMode ? DETECT_PROFILE_TRACKING : DETECT_PROFILE_HASH;
  if (HASH_DEBUG_FORCE_FIXED) {
    const count = Math.max(1, Math.min(5, Number(options.maxVariants) || 1));
    return Array.from({ length: count }, (_, index) => ({
      phash64: '0000303900010932',
      dhash64: '0000574900013032',
      phash_hi: 12345,
      phash_lo: 67890,
      dhash_hi: 22345,
      dhash_lo: 77890,
      bucket16: deriveBucket16FromHi(12345),
      variant: index === 0 ? 'base' : `fixed-${index}`,
      variantIndex: index,
      hashPreviewBase64: '',
      blurVariance: 999,
      quadDetected: true,
      quadConfidence: 1,
      quadPointsCardNorm: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      edgePointsCardNorm: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      quadBBoxCardNorm: { left: 0, top: 0, width: 1, height: 1 },
      hashReady: !isTrackingMode,
      skipReason: isTrackingMode ? 'tracking_only' : '',
    }));
  }

  const tempUris = [];
  try {
    console.log('[hash] start createImageFingerprintCandidates');
    const includeDebugPreview = !!options.includeDebugPreview;
    const previewOnlyFirstVariant = options.previewOnlyFirstVariant !== false;
    const useSyntheticPixels = !!options.useSyntheticPixels;
    const imageBase64 = typeof options.imageBase64 === 'string' ? options.imageBase64 : '';
    const cardFrame = resolveCardFrame(options.cardFrame || {});
    const regionMode = options.regionMode === 'artwork' ? 'artwork' : 'full_card';
    const regionFrame = resolveHashRegionFrame(options.regionFrameInCard || options.artworkFrameInCard || {}, regionMode);
    const variants = buildRegionVariants(regionFrame, Number(options.maxVariants) || 5, regionMode);
    const allowInMemoryTracking = isTrackingMode && !!imageBase64;
    let cardUri = imageUri;
    let cardWidth = 0;
    let cardHeight = 0;
    let inMemoryCardGray = null;
    let useInMemoryCardGray = false;

    if (allowInMemoryTracking) {
      const decodedInput = await decodeJpegBase64(imageBase64);
      if (decodedInput?.width && decodedInput?.height && decodedInput?.data) {
        const fullGray = rgbaToGrayscale(decodedInput.data, decodedInput.width, decodedInput.height);
        const cardCrop = buildCardCropAction(cardFrame, { width: decodedInput.width, height: decodedInput.height });
        const cardCropRect = cardCrop?.crop || {
          originX: 0,
          originY: 0,
          width: decodedInput.width,
          height: decodedInput.height,
        };
        const cardCropped = cropGrayscale(fullGray, decodedInput.width, decodedInput.height, cardCropRect);
        inMemoryCardGray = cardCropped.gray;
        cardWidth = cardCropped.width;
        cardHeight = cardCropped.height;
        useInMemoryCardGray = !!inMemoryCardGray?.length;
        console.log(`[hash] in-memory track source ${cardWidth}x${cardHeight}`);
      }
    }

    if (!useInMemoryCardGray) {
      const imageSize = await getImageSize(imageUri);
      console.log(`[hash] image size ${imageSize.width}x${imageSize.height}`);
      const cardCrop = buildCardCropAction(cardFrame, imageSize);

      const cardActions = cardCrop ? [cardCrop] : [];
      const cardPreview = await ImageManipulator.manipulateAsync(
        imageUri,
        cardActions,
        {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      console.log('[hash] card crop done');
      cardUri = cardPreview?.uri || imageUri;
      if (cardUri !== imageUri) tempUris.push(cardUri);
      cardWidth = cardPreview?.width ?? imageSize.width;
      cardHeight = cardPreview?.height ?? imageSize.height;
    }

    const results = [];
    for (const variant of variants) {
      try {
        console.log(`[hash] variant=${variant.tag} crop:start`);
        let pInput = null;
        let dInput = null;
        let debugPreviewBase64 = '';
        const resultBase = {
          variant: variant.tag,
          variantIndex: variant.index,
          blurVariance: 0,
          quadDetected: false,
          quadConfidence: 0,
          quadPointsCardNorm: null,
          edgePointsCardNorm: null,
          quadBBoxCardNorm: null,
          hashReady: false,
          hashPreviewBase64: '',
          skipReason: 'unknown',
        };
        if (useSyntheticPixels) {
          // one-frame synthetic input to isolate camera decode path
          pInput = new Uint8Array(HASH_P_SIZE * HASH_P_SIZE);
          dInput = resizeGrayscaleNearest(pInput, HASH_P_SIZE, HASH_P_SIZE, HASH_D_WIDTH, HASH_D_HEIGHT);
          resultBase.blurVariance = 999;
          resultBase.quadDetected = true;
          resultBase.quadConfidence = 1;
          resultBase.quadPointsCardNorm = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ];
          resultBase.edgePointsCardNorm = [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.1 },
            { x: 0.9, y: 0.9 },
            { x: 0.1, y: 0.9 },
          ];
          resultBase.quadBBoxCardNorm = { left: 0, top: 0, width: 1, height: 1 };
          resultBase.hashReady = !isTrackingMode;
          resultBase.skipReason = isTrackingMode ? 'tracking_only' : '';
          console.log('[hash] synthetic pixels used');
        } else {
          const regionCrop = buildArtworkCropAction(variant.frame, cardWidth, cardHeight);
          const detectResize = resolveDetectResize(regionCrop.crop.width, regionCrop.crop.height, detectProfile);
          let gray = null;
          let grayWidth = detectResize.width;
          let grayHeight = detectResize.height;
          if (useInMemoryCardGray && inMemoryCardGray) {
            const regionGray = cropGrayscale(inMemoryCardGray, cardWidth, cardHeight, regionCrop.crop);
            gray = resizeGrayscaleNearest(
              regionGray.gray,
              regionGray.width,
              regionGray.height,
              detectResize.width,
              detectResize.height
            );
          } else {
            const cropped = await buildBase64Preview(cardUri, [
              regionCrop,
              { resize: detectResize },
            ]);
            if (cropped.uri && cropped.uri !== cardUri) tempUris.push(cropped.uri);
            console.log(`[hash] variant=${variant.tag} decode:start`);
            const decoded = await decodeJpegBase64(cropped.base64);
            console.log(`[hash] variant=${variant.tag} decode:done ok=${decoded ? '1' : '0'}`);
            if (!decoded) {
              results.push({
                ...resultBase,
                skipReason: 'decode_failed',
              });
              continue;
            }
            gray = rgbaToGrayscale(decoded.data, decoded.width, decoded.height);
            grayWidth = decoded.width;
            grayHeight = decoded.height;
          }

          const blurVariance = computeLaplacianVariance(gray, grayWidth, grayHeight);
          resultBase.blurVariance = Number(blurVariance.toFixed(4));
          if (blurVariance < BLUR_MIN_LAPLACIAN_VARIANCE) {
            console.log(`[hash] variant=${variant.tag} skip:blur variance=${blurVariance.toFixed(2)}`);
            results.push({
              ...resultBase,
              skipReason: 'blur_too_low',
            });
            continue;
          }
          const edgeAnalysis = buildSobelEdgeAnalysis(gray, grayWidth, grayHeight, {
            cardAspectRatio: MTG_CARD_ASPECT_RATIO,
          });
          resultBase.edgePointsCardNorm = normalizeEdgePoints(
            edgeAnalysis.edgePoints,
            grayWidth,
            grayHeight
          );
          const quad = detectCardQuadFromEdges(gray, grayWidth, grayHeight, {
            cardAspectRatio: MTG_CARD_ASPECT_RATIO,
            edgeAnalysis,
            maxSearchMs: isTrackingMode ? 100 : 0,
          });
          if (!quad?.points || quad.points.length !== 4) {
            console.log(`[hash] variant=${variant.tag} skip:quad not detected`);
            results.push({
              ...resultBase,
              skipReason: 'quad_not_detected',
            });
            continue;
          }
          const quadPointsCardNorm = normalizeQuadPoints(quad.points, grayWidth, grayHeight);
          const quadBBoxCardNorm = computeQuadBoundingBox(quadPointsCardNorm);
          resultBase.quadDetected = true;
          resultBase.quadConfidence = Number(quad.confidence ?? 0);
          resultBase.quadPointsCardNorm = quadPointsCardNorm;
          resultBase.quadBBoxCardNorm = quadBBoxCardNorm;
          if (isTrackingMode) {
            resultBase.hashReady = false;
            resultBase.skipReason = 'tracking_only';
            results.push({
              ...resultBase,
              hashPreviewBase64: '',
            });
            continue;
          }

          const warpSize = Math.max(HASH_P_SIZE, Number(HASH_WARP_SIZE) || HASH_P_SIZE);
          const warped = warpQuadToSquare(gray, grayWidth, grayHeight, quad.points, warpSize);
          const preHashInput =
            warpSize === HASH_P_SIZE
              ? warped
              : resizeGrayscaleNearest(warped, warpSize, warpSize, HASH_P_SIZE, HASH_P_SIZE);
          const pre = preprocessGrayscaleForHash(preHashInput);
          pInput = pre;
          dInput = resizeGrayscaleNearest(pre, HASH_P_SIZE, HASH_P_SIZE, HASH_D_WIDTH, HASH_D_HEIGHT);
          resultBase.hashReady = true;
          resultBase.skipReason = '';
          const shouldEncodePreview = includeDebugPreview && (!previewOnlyFirstVariant || variant.index === 0);
          debugPreviewBase64 = shouldEncodePreview ? await encodeDebugPreviewBase64(pInput) : '';
        }

        if (!resultBase.hashReady) {
          results.push({
            ...resultBase,
            hashPreviewBase64: '',
          });
          continue;
        }
        console.log(`[hash] variant=${variant.tag} hash:start`);
        const phashHex = computePHash64FromGrayscale(pInput, HASH_P_SIZE, HASH_P_SIZE);
        const dhashHex = computeDHash64FromGrayscale(dInput, HASH_D_WIDTH, HASH_D_HEIGHT);
        const pSplit = splitHex64ToHiLo(phashHex);
        const dSplit = splitHex64ToHiLo(dhashHex);
        if (!pSplit || !dSplit) {
          results.push({
            ...resultBase,
            hashReady: false,
            hashPreviewBase64: '',
            skipReason: 'hash_split_failed',
          });
          continue;
        }
        console.log(`[hash] variant=${variant.tag} hash:done`);

        results.push({
          ...resultBase,
          phash64: phashHex,
          dhash64: dhashHex,
          phash_hi: pSplit.hi,
          phash_lo: pSplit.lo,
          dhash_hi: dSplit.hi,
          dhash_lo: dSplit.lo,
          bucket16: deriveBucket16FromHi(pSplit.hi),
          blurVariance: Number(resultBase.blurVariance ?? 0),
          quadDetected: !!resultBase.quadDetected,
          quadConfidence: Number(resultBase.quadConfidence ?? 0),
          quadPointsCardNorm: resultBase.quadPointsCardNorm ?? null,
          edgePointsCardNorm: resultBase.edgePointsCardNorm ?? [],
          quadBBoxCardNorm: resultBase.quadBBoxCardNorm ?? null,
          hashReady: true,
          hashPreviewBase64: debugPreviewBase64,
          skipReason: '',
        });
      } catch (variantError) {
        console.error(
          `[hash] variant=${variant.tag} error=${variantError instanceof Error ? variantError.message : 'unknown'}`
        );
      }
    }

    console.log(`[hash] end variants results=${results.length}`);
    return results;
  } catch (error) {
    console.error(`[hash] fatal error=${error instanceof Error ? error.message : 'unknown'}`);
    return [];
  } finally {
    for (const uri of tempUris) {
      if (uri && uri !== imageUri) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
  }
}
