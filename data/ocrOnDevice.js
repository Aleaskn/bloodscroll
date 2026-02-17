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

async function recognizeText(imageUri) {
  if (!imageUri) return '';
  const module = await getTextRecognitionModule();
  if (!module) return '';

  let result = null;
  if (typeof module.recognize === 'function') {
    result = await module.recognize(imageUri);
  } else if (typeof module.process === 'function') {
    result = await module.process(imageUri);
  } else if (typeof module.detect === 'function') {
    result = await module.detect(imageUri);
  }

  return extractTextFromResult(result);
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
  return !!module && ['recognize', 'process', 'detect'].some((key) => typeof module[key] === 'function');
}

export async function extractCardTextOnDevice(imageUri) {
  return recognizeText(imageUri);
}

export async function extractEditionTextOnDevice(imageUri) {
  if (!imageUri) return '';

  let cropUri = null;
  try {
    const { width, height } = await getImageSize(imageUri);
    const cropHeight = Math.max(120, Math.round(height * 0.24));
    const cropWidth = Math.max(220, Math.round(width * 0.48));

    const cropResult = await ImageManipulator.manipulateAsync(
      imageUri,
      [
        {
          crop: {
            originX: 0,
            originY: Math.max(0, height - cropHeight),
            width: Math.min(width, cropWidth),
            height: Math.min(height, cropHeight),
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

    return recognizeText(cropUri);
  } catch {
    return '';
  } finally {
    if (cropUri && cropUri !== imageUri) {
      await FileSystem.deleteAsync(cropUri, { idempotent: true }).catch(() => {});
    }
  }
}

