import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLaplacianVariance,
  computeQuadBoundingBox,
  detectCardQuadFromEdges,
  normalizeQuadPoints,
} from '../data/quadDetectionCore.mjs';

function makeCanvas(width, height, fill = 180) {
  const out = new Uint8Array(width * height);
  out.fill(fill);
  return out;
}

function drawRectOutline(gray, width, rect, color = 30, thickness = 2) {
  const { x, y, w, h } = rect;
  for (let t = 0; t < thickness; t += 1) {
    const top = y + t;
    const bottom = y + h - 1 - t;
    const left = x + t;
    const right = x + w - 1 - t;
    for (let px = left; px <= right; px += 1) {
      gray[top * width + px] = color;
      gray[bottom * width + px] = color;
    }
    for (let py = top; py <= bottom; py += 1) {
      gray[py * width + left] = color;
      gray[py * width + right] = color;
    }
  }
}

function drawLine(gray, width, x0, y0, x1, y1, color = 30) {
  let sx = Math.round(x0);
  let sy = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const stepX = sx < tx ? 1 : -1;
  const stepY = sy < ty ? 1 : -1;
  let err = dx - dy;

  while (true) {
    gray[sy * width + sx] = color;
    if (sx === tx && sy === ty) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      sx += stepX;
    }
    if (e2 < dx) {
      err += dx;
      sy += stepY;
    }
  }
}

test('detectCardQuadFromEdges detects a clear card outline', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  // h/w ~= 1.41 (inside strict MTG acceptance band 1.35..1.45).
  drawRectOutline(gray, width, { x: 20, y: 8, w: 56, h: 79 }, 24, 3);

  const quad = detectCardQuadFromEdges(gray, width, height, { cardAspectRatio: 63 / 88 });
  assert.ok(quad, 'quad should be detected');
  assert.equal(Array.isArray(quad.points), true);
  assert.equal(quad.points.length, 4);
  assert.ok(Number(quad.confidence) >= 0.35, `expected confidence >= 0.35, got ${quad.confidence}`);
});

test('normalizeQuadPoints and computeQuadBoundingBox map corners correctly', () => {
  const points = [
    { x: 8, y: 12 },
    { x: 80, y: 10 },
    { x: 82, y: 90 },
    { x: 10, y: 92 },
  ];
  const normalized = normalizeQuadPoints(points, 96, 96);
  assert.ok(normalized);
  assert.equal(normalized.length, 4);

  const bbox = computeQuadBoundingBox(normalized);
  assert.ok(bbox);
  assert.ok(bbox.left >= 0 && bbox.left <= 1);
  assert.ok(bbox.top >= 0 && bbox.top <= 1);
  assert.ok(bbox.width > 0 && bbox.width <= 1);
  assert.ok(bbox.height > 0 && bbox.height <= 1);
});

test('computeLaplacianVariance is near zero on flat image and detect returns null', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 128);
  const variance = computeLaplacianVariance(gray, width, height);
  assert.equal(variance, 0);

  const quad = detectCardQuadFromEdges(gray, width, height);
  assert.equal(quad, null);
});

test('detectCardQuadFromEdges ignores dominant edges on frame borders', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  // Strong edges only on frame bounds: should not be interpreted as card quad.
  for (let x = 0; x < width; x += 1) {
    gray[(height - 1) * width + x] = 20;
  }
  for (let y = 0; y < height; y += 1) {
    gray[y * width] = 20;
  }

  const quad = detectCardQuadFromEdges(gray, width, height, { cardAspectRatio: 63 / 88 });
  assert.equal(quad, null);
});

test('detectCardQuadFromEdges rejects very narrow non-card ratio rectangles', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  // Unrealistic card ratio (too narrow/tall).
  drawRectOutline(gray, width, { x: 34, y: 8, w: 24, h: 82 }, 24, 3);

  const quad = detectCardQuadFromEdges(gray, width, height, { cardAspectRatio: 63 / 88 });
  assert.equal(quad, null);
});

test('detectCardQuadFromEdges rejects acute-angle quadrilaterals', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  const points = [
    { x: 20, y: 10 }, // tl
    { x: 74, y: 14 }, // tr
    { x: 90, y: 48 }, // br (acute with previous/next)
    { x: 18, y: 86 }, // bl
  ];

  drawLine(gray, width, points[0].x, points[0].y, points[1].x, points[1].y, 20);
  drawLine(gray, width, points[1].x, points[1].y, points[2].x, points[2].y, 20);
  drawLine(gray, width, points[2].x, points[2].y, points[3].x, points[3].y, 20);
  drawLine(gray, width, points[3].x, points[3].y, points[0].x, points[0].y, 20);

  const quad = detectCardQuadFromEdges(gray, width, height, { cardAspectRatio: 63 / 88 });
  assert.equal(quad, null);
});

test('detectCardQuadFromEdges rejects non-convex bow-tie quadrilateral', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  const points = [
    { x: 20, y: 10 },
    { x: 76, y: 86 },
    { x: 76, y: 10 },
    { x: 20, y: 86 },
  ];

  drawLine(gray, width, points[0].x, points[0].y, points[1].x, points[1].y, 20);
  drawLine(gray, width, points[1].x, points[1].y, points[2].x, points[2].y, 20);
  drawLine(gray, width, points[2].x, points[2].y, points[3].x, points[3].y, 20);
  drawLine(gray, width, points[3].x, points[3].y, points[0].x, points[0].y, 20);

  const quad = detectCardQuadFromEdges(gray, width, height, { cardAspectRatio: 63 / 88 });
  assert.equal(quad, null);
});

test('detectCardQuadFromEdges aborts when search budget is exceeded', () => {
  const width = 96;
  const height = 96;
  const gray = makeCanvas(width, height, 176);
  drawRectOutline(gray, width, { x: 20, y: 8, w: 56, h: 79 }, 24, 3);

  const originalNow = Date.now;
  let tick = 0;
  Date.now = () => {
    tick += 5;
    return tick;
  };

  try {
    const quad = detectCardQuadFromEdges(gray, width, height, {
      cardAspectRatio: 63 / 88,
      maxSearchMs: 1,
    });
    assert.equal(quad, null);
  } finally {
    Date.now = originalNow;
  }
});
