import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { Image } from 'react-native';
import {
  computeDHash64FromGrayscale,
  computePHash64FromGrayscale,
  deriveBucket16FromHi,
  normalizeGrayscaleContrast,
  rgbaToGrayscale,
  splitHex64ToHiLo,
} from './fingerprintCore.mjs';

let jpegModulePromise = null;

async function getJpegModule() {
  if (jpegModulePromise) return jpegModulePromise;
  jpegModulePromise = import('jpeg-js')
    .then((module) => module?.default ?? module)
    .catch(() => null);
  return jpegModulePromise;
}

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function buildBase64Preview(imageUri, actions, width, height) {
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [...actions, { resize: { width, height } }],
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

async function decodeJpegBase64(base64) {
  if (!base64) return null;
  const jpeg = await getJpegModule();
  if (!jpeg) return null;
  const bytes = Buffer.from(base64, 'base64');
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

function resolveArtworkFrame(artworkFrameInCard = {}) {
  return {
    leftInCard: clamp01(artworkFrameInCard.leftInCard, 0.08),
    topInCard: clamp01(artworkFrameInCard.topInCard, 0.18),
    widthInCard: clamp01(artworkFrameInCard.widthInCard, 0.84),
    heightInCard: clamp01(artworkFrameInCard.heightInCard, 0.46),
  };
}

function clampArtworkFrame(frame) {
  const widthInCard = Math.min(0.96, Math.max(0.3, clamp01(frame.widthInCard, 0.84)));
  const heightInCard = Math.min(0.8, Math.max(0.2, clamp01(frame.heightInCard, 0.46)));
  const leftInCard = Math.min(1 - widthInCard, Math.max(0, clamp01(frame.leftInCard, 0.08)));
  const topInCard = Math.min(1 - heightInCard, Math.max(0, clamp01(frame.topInCard, 0.18)));
  return { leftInCard, topInCard, widthInCard, heightInCard };
}

function buildArtworkVariants(baseFrame, maxVariants = 5) {
  const seeds = [
    { dx: 0, dy: 0, scale: 1, tag: 'base' },
    { dx: -0.06, dy: 0, scale: 1, tag: 'left' },
    { dx: 0.06, dy: 0, scale: 1, tag: 'right' },
    { dx: 0, dy: -0.05, scale: 1, tag: 'up' },
    { dx: 0, dy: 0.05, scale: 1, tag: 'down' },
    { dx: 0, dy: 0, scale: 0.92, tag: 'tight' },
    { dx: 0, dy: 0, scale: 1.08, tag: 'wide' },
  ];

  return seeds.slice(0, Math.max(1, maxVariants)).map((seed, index) => {
    const width = baseFrame.widthInCard * seed.scale;
    const height = baseFrame.heightInCard * seed.scale;
    return {
      frame: clampArtworkFrame({
        leftInCard: baseFrame.leftInCard + seed.dx - (width - baseFrame.widthInCard) / 2,
        topInCard: baseFrame.topInCard + seed.dy - (height - baseFrame.heightInCard) / 2,
        widthInCard: width,
        heightInCard: height,
      }),
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
  if (!heightRatio && cardFrame.aspectRatio > 0) {
    heightRatio = (widthRatio * imageWidth) / (cardFrame.aspectRatio * imageHeight);
  }

  const originX = Math.max(0, Math.round(imageWidth * left));
  const originY = Math.max(0, Math.round(imageHeight * top));
  const width = Math.max(1, Math.min(Math.round(imageWidth * widthRatio), imageWidth - originX));
  const height = Math.max(1, Math.min(Math.round(imageHeight * heightRatio), imageHeight - originY));

  return { crop: { originX, originY, width, height } };
}

function buildArtworkCropAction(artworkFrame, cardWidth, cardHeight) {
  const originX = Math.max(0, Math.round(cardWidth * artworkFrame.leftInCard));
  const originY = Math.max(0, Math.round(cardHeight * artworkFrame.topInCard));
  const width = Math.max(1, Math.min(Math.round(cardWidth * artworkFrame.widthInCard), cardWidth - originX));
  const height = Math.max(1, Math.min(Math.round(cardHeight * artworkFrame.heightInCard), cardHeight - originY));
  return { crop: { originX, originY, width, height } };
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

export async function createImageFingerprint(imageUri, options = {}) {
  const fingerprints = await createImageFingerprintCandidates(imageUri, { ...options, maxVariants: 1 });
  return fingerprints[0] || null;
}

export async function createImageFingerprintCandidates(imageUri, options = {}) {
  if (!imageUri) return [];

  const tempUris = [];
  try {
    const cardFrame = resolveCardFrame(options.cardFrame || {});
    const artworkFrame = resolveArtworkFrame(options.artworkFrameInCard || {});
    const variants = buildArtworkVariants(artworkFrame, Number(options.maxVariants) || 5);
    const imageSize = await getImageSize(imageUri);
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
    const cardUri = cardPreview?.uri || imageUri;
    if (cardUri !== imageUri) tempUris.push(cardUri);

    const cardWidth = cardPreview?.width ?? imageSize.width;
    const cardHeight = cardPreview?.height ?? imageSize.height;
    const results = [];
    for (const variant of variants) {
      const artworkCrop = buildArtworkCropAction(variant.frame, cardWidth, cardHeight);
      const phashPreview = await buildBase64Preview(cardUri, [artworkCrop], 32, 32);
      const dhashPreview = await buildBase64Preview(cardUri, [artworkCrop], 9, 8);
      if (phashPreview.uri && phashPreview.uri !== cardUri) tempUris.push(phashPreview.uri);
      if (dhashPreview.uri && dhashPreview.uri !== cardUri) tempUris.push(dhashPreview.uri);

      const phashImage = await decodeJpegBase64(phashPreview.base64);
      const dhashImage = await decodeJpegBase64(dhashPreview.base64);
      if (!phashImage || !dhashImage) continue;

      const pGray = normalizeGrayscaleContrast(
        rgbaToGrayscale(phashImage.data, phashImage.width, phashImage.height)
      );
      const dGray = normalizeGrayscaleContrast(
        rgbaToGrayscale(dhashImage.data, dhashImage.width, dhashImage.height)
      );

      const phashHex = computePHash64FromGrayscale(pGray, phashImage.width, phashImage.height);
      const dhashHex = computeDHash64FromGrayscale(dGray, dhashImage.width, dhashImage.height);
      const pSplit = splitHex64ToHiLo(phashHex);
      const dSplit = splitHex64ToHiLo(dhashHex);
      if (!pSplit || !dSplit) continue;

      results.push({
        phash64: phashHex,
        dhash64: dhashHex,
        phash_hi: pSplit.hi,
        phash_lo: pSplit.lo,
        dhash_hi: dSplit.hi,
        dhash_lo: dSplit.lo,
        bucket16: deriveBucket16FromHi(pSplit.hi),
        variant: variant.tag,
        variantIndex: variant.index,
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    for (const uri of tempUris) {
      if (uri && uri !== imageUri) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
  }
}
