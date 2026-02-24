import { HASH_ENABLE_HIST_EQUALIZATION } from './hashConfig';

function clampByte(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}

export function rgbaToGrayscale(rgba, width, height) {
  const pixelCount = Math.max(0, Number(width) * Number(height));
  const gray = new Uint8Array(pixelCount);
  if (!rgba || !pixelCount) return gray;

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const r = clampByte(rgba[offset]);
    const g = clampByte(rgba[offset + 1]);
    const b = clampByte(rgba[offset + 2]);
    // ITU-R BT.601 luma transform.
    gray[i] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
  }

  return gray;
}

export function normalizeGrayscaleContrast(
  gray,
  { lowPercentile = 0.03, highPercentile = 0.97, gamma = 1 } = {}
) {
  if (!gray || !gray.length) return new Uint8Array(0);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    histogram[gray[i]] += 1;
  }

  const total = gray.length;
  const lowTarget = Math.floor(total * Math.max(0, Math.min(1, Number(lowPercentile) || 0)));
  const highTarget = Math.floor(total * Math.max(0, Math.min(1, Number(highPercentile) || 1)));

  let cumulative = 0;
  let low = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= lowTarget) {
      low = i;
      break;
    }
  }

  cumulative = 0;
  let high = 255;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }

  if (high <= low) return new Uint8Array(gray);

  const gammaSafe = Number.isFinite(Number(gamma)) && Number(gamma) > 0 ? Number(gamma) : 1;
  const invRange = 1 / (high - low);
  const output = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const n = Math.max(0, Math.min(1, (gray[i] - low) * invRange));
    const v = gammaSafe === 1 ? n : Math.pow(n, gammaSafe);
    output[i] = clampByte(v * 255);
  }
  return output;
}

export function equalizeGrayscaleHistogram(gray) {
  if (!gray || !gray.length) return new Uint8Array(0);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    histogram[gray[i]] += 1;
  }

  const cdf = new Uint32Array(256);
  let running = 0;
  for (let i = 0; i < 256; i += 1) {
    running += histogram[i];
    cdf[i] = running;
  }

  let cdfMin = 0;
  for (let i = 0; i < 256; i += 1) {
    if (cdf[i] > 0) {
      cdfMin = cdf[i];
      break;
    }
  }
  const total = gray.length;
  const denom = Math.max(1, total - cdfMin);

  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const mapped = ((cdf[gray[i]] - cdfMin) / denom) * 255;
    out[i] = clampByte(mapped);
  }
  return out;
}

export function preprocessGrayscaleForHash(gray) {
  if (!gray || !gray.length) return new Uint8Array(0);
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return new Uint8Array(gray);
  const range = max - min;
  const stretched = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    stretched[i] = clampByte(((gray[i] - min) * 255) / range);
  }
  if (!HASH_ENABLE_HIST_EQUALIZATION) return stretched;
  return equalizeGrayscaleHistogram(stretched);
}

export function resizeGrayscaleNearest(gray, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Uint8Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.round((y / dstHeight) * srcHeight));
    for (let x = 0; x < dstWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.round((x / dstWidth) * srcWidth));
      out[y * dstWidth + x] = gray[srcY * srcWidth + srcX];
    }
  }
  return out;
}

function computeDct2D(values, size) {
  const result = Array.from({ length: size }, () => new Float64Array(size));
  const coeff = Math.PI / (2 * size);

  const cosTable = Array.from({ length: size }, (_, u) => {
    const row = new Float64Array(size);
    for (let x = 0; x < size; x += 1) {
      row[x] = Math.cos((2 * x + 1) * u * coeff);
    }
    return row;
  });

  for (let u = 0; u < size; u += 1) {
    const au = u === 0 ? Math.SQRT1_2 : 1;
    for (let v = 0; v < size; v += 1) {
      const av = v === 0 ? Math.SQRT1_2 : 1;
      let sum = 0;
      for (let x = 0; x < size; x += 1) {
        const rowBase = x * size;
        const cosUx = cosTable[u][x];
        for (let y = 0; y < size; y += 1) {
          sum += values[rowBase + y] * cosUx * cosTable[v][y];
        }
      }
      result[u][v] = (2 / size) * au * av * sum;
    }
  }

  return result;
}

function bitsToHex64(bits) {
  let output = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble =
      ((bits[i] ? 1 : 0) << 3) |
      ((bits[i + 1] ? 1 : 0) << 2) |
      ((bits[i + 2] ? 1 : 0) << 1) |
      (bits[i + 3] ? 1 : 0);
    output += nibble.toString(16);
  }
  return output.padStart(16, '0');
}

export function normalizeHex64(value) {
  const hex = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^0x/, '');
  if (!/^[0-9a-f]{1,16}$/.test(hex)) return '';
  return hex.padStart(16, '0');
}

export function splitHex64ToHiLo(hex64) {
  const normalized = normalizeHex64(hex64);
  if (!normalized) return null;
  const hi = parseInt(normalized.slice(0, 8), 16) | 0;
  const lo = parseInt(normalized.slice(8), 16) | 0;
  return { hi, lo, hex: normalized };
}

export function hiLoToHex64(hi, lo) {
  const hiHex = (hi >>> 0).toString(16).padStart(8, '0');
  const loHex = (lo >>> 0).toString(16).padStart(8, '0');
  return `${hiHex}${loHex}`;
}

export function hiLoToBigInt(hi, lo) {
  const hiUnsigned = BigInt((Number(hi) >>> 0) & 0xffffffff);
  const loUnsigned = BigInt((Number(lo) >>> 0) & 0xffffffff);
  return (hiUnsigned << 32n) | loUnsigned;
}

function popcountBigInt(value) {
  let v = value < 0n ? -value : value;
  let count = 0;
  while (v > 0n) {
    count += Number(v & 1n);
    v >>= 1n;
  }
  return count;
}

function popcount32(n) {
  let value = n >>> 0;
  let count = 0;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

export function hammingDistance64(aHi, aLo, bHi, bLo) {
  return popcount32((aHi ^ bHi) >>> 0) + popcount32((aLo ^ bLo) >>> 0);
}

export function hammingDistance64BigInt(aHi, aLo, bHi, bLo) {
  const a = hiLoToBigInt(aHi, aLo);
  const b = hiLoToBigInt(bHi, bLo);
  return popcountBigInt(a ^ b);
}

export function deriveBucket16FromHi(hi) {
  return ((hi >>> 16) & 0xffff) >>> 0;
}

export function computeDHash64FromGrayscale(gray, width, height) {
  if (!gray || width < 9 || height < 8) return '';
  const bits = new Array(64).fill(false);
  let bitIndex = 0;

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = gray[y * width + x];
      const right = gray[y * width + (x + 1)];
      bits[bitIndex] = left > right;
      bitIndex += 1;
    }
  }

  return bitsToHex64(bits);
}

export function computePHash64FromGrayscale(gray, width, height) {
  if (!gray || width < 32 || height < 32) return '';

  const size = 32;
  const dct = computeDct2D(gray, size);
  const lowFreq = [];
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      if (u === 0 && v === 0) continue;
      lowFreq.push(dct[u][v]);
    }
  }

  const sorted = [...lowFreq].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const bits = new Array(64).fill(false);
  let bitIndex = 0;
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      const value = dct[u][v];
      bits[bitIndex] = u === 0 && v === 0 ? false : value > median;
      bitIndex += 1;
    }
  }

  return bitsToHex64(bits);
}
