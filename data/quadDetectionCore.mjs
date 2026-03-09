const DEFAULT_CARD_ASPECT_RATIO = 63 / 88; // width / height
const TARGET_CARD_HEIGHT_WIDTH_RATIO = 88 / 63;
const EDGE_GAIN = 1.75;
const EDGE_MIN_THRESHOLD = 22;
const CANDIDATES_PER_QUADRANT = 10;
const FRAME_EDGE_IGNORE_RATIO = 0.05;
const FRAME_EDGE_IGNORE_PX = 4;
const MAX_EDGE_POINTS_DEBUG = 260;
const ADAPTIVE_THRESHOLD_RADIUS = 6;
const ADAPTIVE_THRESHOLD_BIAS = 7;
const CONTRAST_STRETCH_LOW_PERCENTILE = 0.05;
const CONTRAST_STRETCH_HIGH_PERCENTILE = 0.95;
const CONTRAST_STRETCH_MIN_DYNAMIC_RANGE = 88;

const STRICT_RATIO_MIN = 1.25;
const STRICT_RATIO_MAX = 1.55;
const MIN_CORNER_ANGLE_DEG = 70;
const MAX_CORNER_ANGLE_DEG = 110;
const MAX_OPPOSITE_SIDE_RATIO = 1.35;
const MIN_EDGE_SUPPORT_PER_SIDE = 0.162;
const MIN_EDGE_SUPPORT_AVG = 0.252;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 1);
}

function distance(a, b) {
  const dx = Number(a?.x ?? 0) - Number(b?.x ?? 0);
  const dy = Number(a?.y ?? 0) - Number(b?.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function signedPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (Number(a?.x ?? 0) * Number(b?.y ?? 0)) - (Number(b?.x ?? 0) * Number(a?.y ?? 0));
  }
  return sum / 2;
}

function angleBetweenDegrees(v1, v2) {
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (!mag1 || !mag2) return 0;
  const cos = clamp(dot / (mag1 * mag2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function computeCornerAngleDegrees(prev, center, next) {
  const v1 = { x: prev.x - center.x, y: prev.y - center.y };
  const v2 = { x: next.x - center.x, y: next.y - center.y };
  return angleBetweenDegrees(v1, v2);
}

function computePercentileFromHistogram(hist, total, percentile, fallback = 0) {
  if (!hist || !hist.length || total <= 0) return fallback;
  const target = clamp(Math.floor(total * clamp01(percentile, 1)), 0, total - 1);
  let acc = 0;
  for (let i = 0; i < hist.length; i += 1) {
    acc += hist[i];
    if (acc > target) return i;
  }
  return fallback;
}

function addCandidate(bucket, candidate, limit) {
  bucket.push(candidate);
  bucket.sort((a, b) => b.score - a.score);
  if (bucket.length > limit) bucket.length = limit;
}

function edgeValue(mag, width, x, y) {
  const ix = clamp(Math.round(x), 0, width - 1);
  const iy = clamp(Math.round(y), 0, Math.floor(mag.length / width) - 1);
  return Number(mag[iy * width + ix] ?? 0);
}

function computeEdgeSupport(mag, width, threshold, a, b, samples = 24) {
  let score = 0;
  let support = 0;
  for (let i = 0; i <= samples; i += 1) {
    const t = samples <= 0 ? 0 : i / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const value = edgeValue(mag, width, x, y);
    const normalized = threshold > 0 ? clamp(value / (threshold * 1.35), 0, 1) : 0;
    score += normalized;
    if (value >= threshold * 0.9) support += 1;
  }
  const normScore = score / (samples + 1);
  const ratioScore = support / (samples + 1);
  return (normScore * 0.7) + (ratioScore * 0.3);
}

function validateQuadOrdering(tl, tr, br, bl) {
  if (tl.x >= tr.x || bl.x >= br.x) return false;
  if (tl.y >= bl.y || tr.y >= br.y) return false;
  return true;
}

function isPointAwayFromEdges(point, width, height, marginX, marginY) {
  return (
    point.x >= marginX &&
    point.x <= width - 1 - marginX &&
    point.y >= marginY &&
    point.y <= height - 1 - marginY
  );
}

function crossZ(a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  return (abx * bcy) - (aby * bcx);
}

function isConvexQuad(points) {
  if (!Array.isArray(points) || points.length !== 4) return false;
  const signs = [];
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const z = crossZ(a, b, c);
    if (Math.abs(z) < 1e-6) return false;
    signs.push(Math.sign(z));
  }
  const first = signs[0];
  return signs.every((sign) => sign === first);
}

function stretchContrastPercentile(gray, lowPercentile = 0.05, highPercentile = 0.95) {
  if (!gray?.length) return { image: new Uint8Array(0), low: 0, high: 255 };
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    hist[gray[i]] += 1;
  }
  const total = gray.length;
  const low = computePercentileFromHistogram(hist, total, lowPercentile, 0);
  const high = computePercentileFromHistogram(hist, total, highPercentile, 255);
  if (high <= low) {
    return {
      image: new Uint8Array(gray),
      low,
      high,
    };
  }
  if ((high - low) >= CONTRAST_STRETCH_MIN_DYNAMIC_RANGE) {
    return {
      image: gray,
      low,
      high,
    };
  }
  const inv = 255 / Math.max(1, high - low);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const v = clamp((gray[i] - low) * inv, 0, 255);
    out[i] = Math.round(v);
  }
  return {
    image: out,
    low,
    high,
  };
}

function computeIntegralImage(gray, width, height) {
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  return integral;
}

function sumRectIntegral(integral, widthPlusOne, x0, y0, x1, y1) {
  return (
    integral[(y1 + 1) * widthPlusOne + (x1 + 1)] -
    integral[y0 * widthPlusOne + (x1 + 1)] -
    integral[(y1 + 1) * widthPlusOne + x0] +
    integral[y0 * widthPlusOne + x0]
  );
}

function applyAdaptiveThreshold(gray, width, height, radius = ADAPTIVE_THRESHOLD_RADIUS, bias = ADAPTIVE_THRESHOLD_BIAS) {
  const out = new Uint8Array(gray.length);
  if (!gray.length || width < 3 || height < 3) return out;
  const integral = computeIntegralImage(gray, width, height);
  const widthPlusOne = width + 1;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
      const localMean = sumRectIntegral(integral, widthPlusOne, x0, y0, x1, y1) / area;
      const idx = y * width + x;
      const binary = gray[idx] > (localMean - bias) ? 255 : 0;
      out[idx] = Math.round((gray[idx] * 0.3) + (binary * 0.7));
    }
  }

  return out;
}

function buildAdaptiveEdgeInput(gray, width, height) {
  const stretched = stretchContrastPercentile(
    gray,
    CONTRAST_STRETCH_LOW_PERCENTILE,
    CONTRAST_STRETCH_HIGH_PERCENTILE
  );
  const adaptive = applyAdaptiveThreshold(stretched.image, width, height);
  let sum = 0;
  for (let i = 0; i < adaptive.length; i += 1) {
    sum += adaptive[i];
  }
  const adaptiveLevel = adaptive.length ? Math.round(sum / adaptive.length) : 0;
  return {
    image: adaptive,
    adaptiveLevel,
    stretchLow: stretched.low,
    stretchHigh: stretched.high,
  };
}

function collectEdgePoints(mag, width, height, threshold, marginX, marginY, maxPoints = MAX_EDGE_POINTS_DEBUG) {
  const candidates = [];
  const stepX = Math.max(1, Math.floor((width - (2 * marginX)) / 64));
  const stepY = Math.max(1, Math.floor((height - (2 * marginY)) / 96));

  for (let y = marginY; y < height - marginY; y += stepY) {
    for (let x = marginX; x < width - marginX; x += stepX) {
      const value = mag[y * width + x];
      if (value >= threshold) {
        addCandidate(candidates, { x, y, score: value }, maxPoints);
      }
    }
  }

  return candidates.map((entry) => ({ x: entry.x, y: entry.y }));
}

export function computeLaplacianVariance(gray, width, height) {
  if (!gray?.length || width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = gray[y * width + x];
      const lap =
        gray[(y - 1) * width + x] +
        gray[(y + 1) * width + x] +
        gray[y * width + (x - 1)] +
        gray[y * width + (x + 1)] -
        (4 * center);
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, (sumSq / count) - (mean * mean));
}

export function computeSobelMagnitude(gray, width, height, gain = EDGE_GAIN) {
  const mag = new Float32Array(width * height);
  if (!gray?.length || width < 3 || height < 3) return mag;
  const gainValue = Number.isFinite(Number(gain)) ? Number(gain) : EDGE_GAIN;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i00 = gray[(y - 1) * width + (x - 1)];
      const i01 = gray[(y - 1) * width + x];
      const i02 = gray[(y - 1) * width + (x + 1)];
      const i10 = gray[y * width + (x - 1)];
      const i12 = gray[y * width + (x + 1)];
      const i20 = gray[(y + 1) * width + (x - 1)];
      const i21 = gray[(y + 1) * width + x];
      const i22 = gray[(y + 1) * width + (x + 1)];
      const gx = -i00 + i02 - (2 * i10) + (2 * i12) - i20 + i22;
      const gy = -i00 - (2 * i01) - i02 + i20 + (2 * i21) + i22;
      mag[y * width + x] = (Math.abs(gx) + Math.abs(gy)) * gainValue;
    }
  }
  return mag;
}

export function buildSobelEdgeAnalysis(gray, width, height, options = {}) {
  if (!gray?.length || width < 12 || height < 12) {
    return {
      mag: new Float32Array(width * height),
      threshold: Number.POSITIVE_INFINITY,
      edgePoints: [],
      marginX: 0,
      marginY: 0,
      adaptiveLevel: 0,
      stretchLow: 0,
      stretchHigh: 0,
      otsuThreshold: 0,
    };
  }

  const marginX = Math.max(FRAME_EDGE_IGNORE_PX, Math.round(width * FRAME_EDGE_IGNORE_RATIO));
  const marginY = Math.max(FRAME_EDGE_IGNORE_PX, Math.round(height * FRAME_EDGE_IGNORE_RATIO));
  const adaptive = buildAdaptiveEdgeInput(gray, width, height);
  const mag = computeSobelMagnitude(adaptive.image, width, height, options.edgeGain ?? EDGE_GAIN);

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let maxValue = 0;
  for (let y = marginY; y < height - marginY; y += 1) {
    for (let x = marginX; x < width - marginX; x += 1) {
      const value = mag[y * width + x];
      if (value <= 0) continue;
      sum += value;
      sumSq += value * value;
      count += 1;
      if (value > maxValue) maxValue = value;
    }
  }

  if (!count) {
    return {
      mag,
      threshold: Number.POSITIVE_INFINITY,
      edgePoints: [],
      marginX,
      marginY,
      adaptiveLevel: adaptive.adaptiveLevel,
      stretchLow: adaptive.stretchLow,
      stretchHigh: adaptive.stretchHigh,
      otsuThreshold: adaptive.adaptiveLevel,
    };
  }

  const mean = sum / count;
  const variance = Math.max(0, (sumSq / count) - (mean * mean));
  const stdDev = Math.sqrt(variance);
  const dynamicThreshold = mean + (stdDev * 0.85);
  const threshold = Math.max(EDGE_MIN_THRESHOLD, Math.min(dynamicThreshold, maxValue * 0.95));
  const edgePoints = collectEdgePoints(mag, width, height, threshold, marginX, marginY, MAX_EDGE_POINTS_DEBUG);

  return {
    mag,
    threshold,
    edgePoints,
    marginX,
    marginY,
    adaptiveLevel: adaptive.adaptiveLevel,
    stretchLow: adaptive.stretchLow,
    stretchHigh: adaptive.stretchHigh,
    otsuThreshold: adaptive.adaptiveLevel,
  };
}

function evaluateQuad(points, edgeAnalysis, width, height, cardAspectRatio) {
  const [tl, tr, br, bl] = points;
  if (!validateQuadOrdering(tl, tr, br, bl)) return null;
  if (!isConvexQuad(points)) return null;
  if (!isPointAwayFromEdges(tl, width, height, edgeAnalysis.marginX, edgeAnalysis.marginY)) return null;
  if (!isPointAwayFromEdges(tr, width, height, edgeAnalysis.marginX, edgeAnalysis.marginY)) return null;
  if (!isPointAwayFromEdges(br, width, height, edgeAnalysis.marginX, edgeAnalysis.marginY)) return null;
  if (!isPointAwayFromEdges(bl, width, height, edgeAnalysis.marginX, edgeAnalysis.marginY)) return null;

  const area = Math.abs(signedPolygonArea(points));
  const frameArea = width * height;
  const areaRatio = area / Math.max(1, frameArea);
  if (areaRatio < 0.16 || areaRatio > 0.92) return null;

  const topLen = distance(tl, tr);
  const rightLen = distance(tr, br);
  const bottomLen = distance(br, bl);
  const leftLen = distance(bl, tl);
  if (!topLen || !rightLen || !bottomLen || !leftLen) return null;

  const avgWidth = (topLen + bottomLen) / 2;
  const avgHeight = (leftLen + rightLen) / 2;
  if (!avgWidth || !avgHeight) return null;
  if (avgWidth < width * 0.25 || avgHeight < height * 0.25) return null;

  const ratioHW = avgHeight / Math.max(1e-6, avgWidth);
  if (ratioHW < STRICT_RATIO_MIN || ratioHW > STRICT_RATIO_MAX) return null;

  const horizontalSideRatio = Math.max(topLen, bottomLen) / Math.max(1, Math.min(topLen, bottomLen));
  const verticalSideRatio = Math.max(leftLen, rightLen) / Math.max(1, Math.min(leftLen, rightLen));
  if (horizontalSideRatio > MAX_OPPOSITE_SIDE_RATIO) return null;
  if (verticalSideRatio > MAX_OPPOSITE_SIDE_RATIO) return null;

  const cornerAngles = [
    computeCornerAngleDegrees(bl, tl, tr),
    computeCornerAngleDegrees(tl, tr, br),
    computeCornerAngleDegrees(tr, br, bl),
    computeCornerAngleDegrees(br, bl, tl),
  ];
  if (cornerAngles.some((angle) => angle < MIN_CORNER_ANGLE_DEG || angle > MAX_CORNER_ANGLE_DEG)) return null;

  const sideSupports = [
    computeEdgeSupport(edgeAnalysis.mag, width, edgeAnalysis.threshold, tl, tr),
    computeEdgeSupport(edgeAnalysis.mag, width, edgeAnalysis.threshold, tr, br),
    computeEdgeSupport(edgeAnalysis.mag, width, edgeAnalysis.threshold, br, bl),
    computeEdgeSupport(edgeAnalysis.mag, width, edgeAnalysis.threshold, bl, tl),
  ];
  const edgeSupport = sideSupports.reduce((acc, value) => acc + value, 0) / sideSupports.length;
  if (edgeSupport < MIN_EDGE_SUPPORT_AVG) return null;
  if (sideSupports.some((value) => value < MIN_EDGE_SUPPORT_PER_SIDE)) return null;

  const ratioScore = 1 - clamp(Math.abs(ratioHW - TARGET_CARD_HEIGHT_WIDTH_RATIO) / 0.05, 0, 1);
  const angleScore =
    cornerAngles.reduce((acc, angle) => acc + (1 - clamp(Math.abs(angle - 90) / 10, 0, 1)), 0) /
    cornerAngles.length;
  const sideBalanceScore =
    ((1 - clamp((horizontalSideRatio - 1) / 0.35, 0, 1)) +
      (1 - clamp((verticalSideRatio - 1) / 0.35, 0, 1))) /
    2;
  const areaScore = clamp((areaRatio - 0.16) / 0.3, 0, 1);

  const geometryScore =
    (ratioScore * 0.4) +
    (angleScore * 0.35) +
    (sideBalanceScore * 0.15) +
    (areaScore * 0.1);

  const confidence = (geometryScore * 0.8) + (edgeSupport * 0.2);

  const widthHeightRatio = Number(cardAspectRatio) > 0 ? Number(cardAspectRatio) : DEFAULT_CARD_ASPECT_RATIO;
  const aspectConsistency = 1 - clamp(Math.abs((1 / ratioHW) - widthHeightRatio) / Math.max(widthHeightRatio, 1e-6), 0, 1);

  return {
    confidence,
    geometryScore,
    edgeSupport,
    sideSupports,
    area,
    ratioHW,
    aspectConsistency,
    cornerAngles,
    points: points.map((point) => ({ x: point.x, y: point.y })),
  };
}

export function detectCardQuadFromEdges(gray, width, height, options = {}) {
  if (!gray?.length || width < 12 || height < 12) return null;
  const cardAspectRatio =
    Number(options.cardAspectRatio) > 0 ? Number(options.cardAspectRatio) : DEFAULT_CARD_ASPECT_RATIO;
  const maxSearchMs = Math.max(0, Number(options.maxSearchMs ?? 0));
  const searchStartedAt = maxSearchMs > 0 ? Date.now() : 0;

  const edgeAnalysis = options.edgeAnalysis || buildSobelEdgeAnalysis(gray, width, height, options);
  if (!edgeAnalysis.edgePoints.length || !Number.isFinite(edgeAnalysis.threshold)) return null;

  const quadCandidates = [[], [], [], []];
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const corners = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const maxDist = Math.sqrt((width - 1) * (width - 1) + (height - 1) * (height - 1));

  for (const point of edgeAnalysis.edgePoints) {
    if (maxSearchMs > 0 && (Date.now() - searchStartedAt) > maxSearchMs) return null;
    const x = point.x;
    const y = point.y;
    const qx = x < halfW ? 0 : 1;
    const qy = y < halfH ? 0 : 1;
    const quadrantIndex = qx + (qy * 2);
    const corner = corners[quadrantIndex];
    const value = edgeAnalysis.mag[y * width + x];
    const d = Math.sqrt(((x - corner.x) ** 2) + ((y - corner.y) ** 2));
    const cornerBias = 1 - clamp(d / Math.max(maxDist, 1), 0, 1);
    const score = value + (cornerBias * edgeAnalysis.threshold * 0.9);
    addCandidate(quadCandidates[quadrantIndex], { x, y, score }, CANDIDATES_PER_QUADRANT);
  }

  if (quadCandidates.some((bucket) => !bucket.length)) return null;

  let best = null;
  for (const tl of quadCandidates[0]) {
    if (maxSearchMs > 0 && (Date.now() - searchStartedAt) > maxSearchMs) return null;
    for (const tr of quadCandidates[1]) {
      if (maxSearchMs > 0 && (Date.now() - searchStartedAt) > maxSearchMs) return null;
      for (const br of quadCandidates[3]) {
        if (maxSearchMs > 0 && (Date.now() - searchStartedAt) > maxSearchMs) return null;
        for (const bl of quadCandidates[2]) {
          if (maxSearchMs > 0 && (Date.now() - searchStartedAt) > maxSearchMs) return null;
          const evaluated = evaluateQuad(
            [tl, tr, br, bl],
            edgeAnalysis,
            width,
            height,
            cardAspectRatio
          );
          if (!evaluated) continue;
          if (!best || evaluated.confidence > best.confidence) best = evaluated;
        }
      }
    }
  }

  if (!best) return null;
  return {
    points: best.points,
    confidence: Math.round(best.confidence * 1000) / 1000,
    geometryScore: Math.round(best.geometryScore * 1000) / 1000,
    edgeSupport: Math.round(best.edgeSupport * 1000) / 1000,
    sideSupports: best.sideSupports.map((value) => Math.round(value * 1000) / 1000),
    threshold: Math.round(edgeAnalysis.threshold * 1000) / 1000,
    adaptiveLevel: edgeAnalysis.adaptiveLevel,
    stretchLow: edgeAnalysis.stretchLow,
    stretchHigh: edgeAnalysis.stretchHigh,
    otsuThreshold: edgeAnalysis.adaptiveLevel,
    area: Math.round(best.area),
    ratioHW: Math.round(best.ratioHW * 1000) / 1000,
    cornerAngles: best.cornerAngles.map((angle) => Math.round(angle * 100) / 100),
    edgePoints: edgeAnalysis.edgePoints,
  };
}

export function normalizeQuadPoints(quadPoints, width, height) {
  if (!Array.isArray(quadPoints) || quadPoints.length !== 4) return null;
  const normW = Math.max(1, Number(width) - 1);
  const normH = Math.max(1, Number(height) - 1);
  const normalized = quadPoints.map((point) => ({
    x: clamp01(Number(point?.x ?? 0) / normW, 0),
    y: clamp01(Number(point?.y ?? 0) / normH, 0),
  }));
  return normalized;
}

export function computeQuadBoundingBox(pointsNorm) {
  if (!Array.isArray(pointsNorm) || pointsNorm.length !== 4) return null;
  const xs = pointsNorm.map((point) => clamp01(point?.x, 0));
  const ys = pointsNorm.map((point) => clamp01(point?.y, 0));
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
