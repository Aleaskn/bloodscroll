import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { Image } from 'react-native';
import {
  computeDHash64FromGrayscale,
  computePHash64FromGrayscale,
  deriveBucket16FromHi,
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
  if (!imageUri) return null;

  const tempUris = [];
  try {
    const cardFrame = resolveCardFrame(options.cardFrame || {});
    const artworkFrame = resolveArtworkFrame(options.artworkFrameInCard || {});
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
    const artworkCrop = buildArtworkCropAction(artworkFrame, cardWidth, cardHeight);

    const phashPreview = await buildBase64Preview(cardUri, [artworkCrop], 32, 32);
    const dhashPreview = await buildBase64Preview(cardUri, [artworkCrop], 9, 8);
    if (phashPreview.uri && phashPreview.uri !== cardUri) tempUris.push(phashPreview.uri);
    if (dhashPreview.uri && dhashPreview.uri !== cardUri) tempUris.push(dhashPreview.uri);

    const phashImage = await decodeJpegBase64(phashPreview.base64);
    const dhashImage = await decodeJpegBase64(dhashPreview.base64);
    if (!phashImage || !dhashImage) return null;

    const pGray = rgbaToGrayscale(phashImage.data, phashImage.width, phashImage.height);
    const dGray = rgbaToGrayscale(dhashImage.data, dhashImage.width, dhashImage.height);

    const phashHex = computePHash64FromGrayscale(pGray, phashImage.width, phashImage.height);
    const dhashHex = computeDHash64FromGrayscale(dGray, dhashImage.width, dhashImage.height);
    const pSplit = splitHex64ToHiLo(phashHex);
    const dSplit = splitHex64ToHiLo(dhashHex);
    if (!pSplit || !dSplit) return null;

    return {
      phash64: phashHex,
      dhash64: dhashHex,
      phash_hi: pSplit.hi,
      phash_lo: pSplit.lo,
      dhash_hi: dSplit.hi,
      dhash_lo: dSplit.lo,
      bucket16: deriveBucket16FromHi(pSplit.hi),
    };
  } catch {
    return null;
  } finally {
    for (const uri of tempUris) {
      if (uri && uri !== imageUri) {
        // eslint-disable-next-line no-await-in-loop
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
  }
}
