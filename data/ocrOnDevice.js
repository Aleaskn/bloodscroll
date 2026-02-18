import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';

let textRecognitionModulePromise = null;

function normalizeRecognizedText(value) {
  if (typeof value !== 'string') return '';
  return value
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractTextFromResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return normalizeRecognizedText(result);
  if (typeof result.text === 'string') return normalizeRecognizedText(result.text);

  if (Array.isArray(result.blocks)) {
    return normalizeRecognizedText(result.blocks.map((block) => block?.text).filter(Boolean).join('\n'));
  }

  if (Array.isArray(result.textBlocks)) {
    return normalizeRecognizedText(
      result.textBlocks.map((block) => block?.text || block?.value).filter(Boolean).join('\n')
    );
  }

  return '';
}

async function getTextRecognitionModule() {
  if (textRecognitionModulePromise) return textRecognitionModulePromise;

  textRecognitionModulePromise = import('@react-native-ml-kit/text-recognition')
    .then((module) => module?.default ?? module?.TextRecognition ?? module)
    .catch(() => null);

  return textRecognitionModulePromise;
}

function resolveRecognizer(module) {
  return module?.default ?? module?.TextRecognition ?? module;
}

function resolveScriptEnum(module) {
  return module?.TextRecognitionScript ?? module?.default?.TextRecognitionScript ?? null;
}

async function recognizeText(imageUri, script = null) {
  if (!imageUri) return '';
  const module = await getTextRecognitionModule();
  if (!module) return '';
  const recognizer = resolveRecognizer(module);
  if (!recognizer) return '';

  let result = null;
  if (typeof recognizer.recognize === 'function') {
    result = script ? await recognizer.recognize(imageUri, script) : await recognizer.recognize(imageUri);
  } else if (typeof recognizer.process === 'function') {
    result = await recognizer.process(imageUri);
  } else if (typeof recognizer.detect === 'function') {
    result = await recognizer.detect(imageUri);
  }

  return extractTextFromResult(result);
}

async function createDownscaledCopy(imageUri, maxDimension) {
  if (!imageUri) return null;
  const { width, height } = await getImageSize(imageUri);
  if (!width || !height) return null;

  const longest = Math.max(width, height);
  if (longest <= maxDimension) return null;

  const scale = maxDimension / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: targetWidth, height: targetHeight } }],
    {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  return resized?.uri ?? null;
}

async function createOcrOptimizedCopy(imageUri, { maxDimension = 0, minDimension = 0 } = {}) {
  if (!imageUri) return null;
  const { width, height } = await getImageSize(imageUri);
  if (!width || !height) return null;
  const longest = Math.max(width, height);

  let targetLongest = longest;
  if (maxDimension > 0 && longest > maxDimension) {
    targetLongest = maxDimension;
  } else if (minDimension > 0 && longest < minDimension) {
    targetLongest = minDimension;
  } else {
    return null;
  }

  const scale = targetLongest / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: targetWidth, height: targetHeight } }],
    {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  return resized?.uri ?? null;
}

function getImageSize(imageUri) {
  return new Promise((resolve, reject) => {
    Image.getSize(
      imageUri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}

export async function isOnDeviceOcrAvailable() {
  const module = await getTextRecognitionModule();
  const recognizer = resolveRecognizer(module);
  return !!recognizer && ['recognize', 'process', 'detect'].some((key) => typeof recognizer[key] === 'function');
}

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function resolveCardFrameRatios(cardFrame, imageWidth, imageHeight) {
  const left = clamp01(cardFrame?.left, 0);
  const top = clamp01(cardFrame?.top, 0);
  const width = clamp01(cardFrame?.width, 1);
  const explicitHeight = Number(cardFrame?.height);

  if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      left,
      top,
      width,
      height: clamp01(explicitHeight, 1),
    };
  }

  const aspectRatio = Number(cardFrame?.aspectRatio);
  if (Number.isFinite(aspectRatio) && aspectRatio > 0 && imageWidth > 0 && imageHeight > 0) {
    const height = (width * imageWidth) / (aspectRatio * imageHeight);
    return {
      left,
      top,
      width,
      height: clamp01(height, 1),
    };
  }

  return {
    left,
    top,
    width,
    height: 1,
  };
}

export async function extractCardTextOnDevice(imageUri, options = {}) {
  if (!imageUri) return '';

  let cropUri = null;
  let resizedUri = null;
  try {
    const { width, height } = await getImageSize(imageUri);
    const { left, top, width: cardWidth, height: cardHeight } = resolveCardFrameRatios(
      options?.cardFrame ?? {},
      width,
      height
    );

    const originX = Math.max(0, Math.round(width * left));
    const originY = Math.max(0, Math.round(height * top));
    const cropWidth = Math.max(220, Math.round(width * cardWidth));
    const cropHeight = Math.max(280, Math.round(height * cardHeight));
    const safeWidth = Math.max(1, Math.min(cropWidth, width - originX));
    const safeHeight = Math.max(1, Math.min(cropHeight, height - originY));

    const cropResult = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          crop: {
            originX,
            originY,
            width: safeWidth,
            height: safeHeight,
          },
        },
      ],
      {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    cropUri = cropResult?.uri ?? imageUri;
    resizedUri = await createDownscaledCopy(cropUri, 1280);
    return recognizeText(resizedUri || cropUri);
  } catch {
    return '';
  } finally {
    if (resizedUri && resizedUri !== cropUri && resizedUri !== imageUri) {
      await FileSystem.deleteAsync(resizedUri, { idempotent: true }).catch(() => {});
    }
    if (cropUri && cropUri !== imageUri) {
      await FileSystem.deleteAsync(cropUri, { idempotent: true }).catch(() => {});
    }
  }
}

export async function extractCardTitleTextOnDevice(imageUri, options = {}) {
  if (!imageUri) return '';

  let cropUri = null;
  let optimizedUri = null;
  try {
    const { width, height } = await getImageSize(imageUri);
    const { left, top, width: cardWidth, height: cardHeight } = resolveCardFrameRatios(
      options?.cardFrame ?? {},
      width,
      height
    );

    const titleLeft = clamp01(left + cardWidth * 0.02, 0);
    const titleTop = clamp01(top + cardHeight * 0.02, 0);
    const titleWidth = clamp01(cardWidth * 0.96, 1);
    const titleHeight = clamp01(cardHeight * 0.14, 1);

    const originX = Math.max(0, Math.round(width * titleLeft));
    const originY = Math.max(0, Math.round(height * titleTop));
    const cropWidth = Math.max(220, Math.round(width * titleWidth));
    const cropHeight = Math.max(90, Math.round(height * titleHeight));
    const safeWidth = Math.max(1, Math.min(cropWidth, width - originX));
    const safeHeight = Math.max(1, Math.min(cropHeight, height - originY));

    const cropResult = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          crop: {
            originX,
            originY,
            width: safeWidth,
            height: safeHeight,
          },
        },
      ],
      {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    cropUri = cropResult?.uri ?? null;
    if (!cropUri) return '';

    optimizedUri = await createOcrOptimizedCopy(cropUri, { minDimension: 1200, maxDimension: 1800 });
    const source = optimizedUri || cropUri;
    const latinText = await recognizeText(source);
    if (latinText && latinText.length >= 3) return latinText;

    if (options.enableMultilingualFallback) {
      const module = await getTextRecognitionModule();
      const scriptEnum = resolveScriptEnum(module);
      if (scriptEnum?.JAPANESE) {
        const jpText = await recognizeText(source, scriptEnum.JAPANESE);
        if (jpText) return jpText;
      }
    }
    return latinText;
  } catch {
    return '';
  } finally {
    if (optimizedUri && optimizedUri !== cropUri && optimizedUri !== imageUri) {
      await FileSystem.deleteAsync(optimizedUri, { idempotent: true }).catch(() => {});
    }
    if (cropUri && cropUri !== imageUri) {
      await FileSystem.deleteAsync(cropUri, { idempotent: true }).catch(() => {});
    }
  }
}

export async function extractEditionTextOnDevice(imageUri, options = {}) {
  if (!imageUri) return '';

  const tempUris = [];
  try {
    const { width, height } = await getImageSize(imageUri);
    const cardFrame = options?.cardFrame ?? {};
    const editionFrameInCard = options?.editionFrameInCard ?? {};

    const { left: cardLeft, top: cardTop, width: cardWidth, height: cardHeight } = resolveCardFrameRatios(
      cardFrame,
      width,
      height
    );

    const base = {
      leftInCard: clamp01(editionFrameInCard.leftInCard, 0.02),
      topInCard: clamp01(editionFrameInCard.topInCard, 0.88),
      widthInCard: clamp01(editionFrameInCard.widthInCard, 0.5),
      heightInCard: clamp01(editionFrameInCard.heightInCard, 0.065),
    };
    const variants = [
      base,
      {
        leftInCard: 0.02,
        topInCard: 0.88,
        widthInCard: 0.64,
        heightInCard: 0.09,
      },
      {
        leftInCard: 0.02,
        topInCard: 0.85,
        widthInCard: 0.72,
        heightInCard: 0.12,
      },
    ];

    const texts = [];
    for (const variant of variants) {
      const roiLeft = clamp01(cardLeft + cardWidth * variant.leftInCard, 0);
      const roiTop = clamp01(cardTop + cardHeight * variant.topInCard, 0.7);
      const roiWidth = clamp01(cardWidth * variant.widthInCard, 0.85);
      const roiHeight = clamp01(cardHeight * variant.heightInCard, 0.25);

      const originX = Math.max(0, Math.round(width * roiLeft));
      const originY = Math.max(0, Math.round(height * roiTop));
      const cropWidth = Math.max(140, Math.round(width * roiWidth));
      const cropHeight = Math.max(80, Math.round(height * roiHeight));
      const safeWidth = Math.max(1, Math.min(cropWidth, width - originX));
      const safeHeight = Math.max(1, Math.min(cropHeight, height - originY));

      // eslint-disable-next-line no-await-in-loop
      const cropResult = await ImageManipulator.manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX,
              originY,
              width: safeWidth,
              height: safeHeight,
            },
          },
        ],
        {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      const cropUri = cropResult?.uri ?? null;
      if (!cropUri) continue;
      tempUris.push(cropUri);
      // eslint-disable-next-line no-await-in-loop
      const resizedCropUri = await createOcrOptimizedCopy(cropUri, { minDimension: 1200, maxDimension: 1500 });
      if (resizedCropUri) tempUris.push(resizedCropUri);
      // eslint-disable-next-line no-await-in-loop
      const text = await recognizeText(resizedCropUri || cropUri);
      if (text) texts.push(text);
    }

    return normalizeRecognizedText(texts.join('\n'));
  } catch {
    return '';
  } finally {
    for (const uri of tempUris) {
      if (uri && uri !== imageUri) {
        // eslint-disable-next-line no-await-in-loop
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
  }
}
