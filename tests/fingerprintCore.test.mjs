import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDHash64FromGrayscale,
  computePHash64FromGrayscale,
  deriveBucket16FromHi,
  hammingDistance64,
  hiLoToHex64,
  splitHex64ToHiLo,
} from '../data/fingerprintCore.mjs';

test('splitHex64ToHiLo and hiLoToHex64 are reversible', () => {
  const split = splitHex64ToHiLo('89abcdef01234567');
  assert.ok(split);
  assert.equal(hiLoToHex64(split.hi, split.lo), '89abcdef01234567');
});

test('hammingDistance64 computes bit distance across hi/lo', () => {
  const a = splitHex64ToHiLo('ffffffff00000000');
  const b = splitHex64ToHiLo('0fffffff00000001');
  assert.ok(a && b);
  assert.equal(hammingDistance64(a.hi, a.lo, b.hi, b.lo), 5);
});

test('compute hashes from grayscale return 64-bit hex strings', () => {
  const gray32 = new Uint8Array(32 * 32);
  for (let i = 0; i < gray32.length; i += 1) {
    gray32[i] = i % 255;
  }
  const gray9x8 = new Uint8Array(9 * 8);
  for (let i = 0; i < gray9x8.length; i += 1) {
    gray9x8[i] = (i * 3) % 255;
  }

  const phash = computePHash64FromGrayscale(gray32, 32, 32);
  const dhash = computeDHash64FromGrayscale(gray9x8, 9, 8);

  assert.match(phash, /^[0-9a-f]{16}$/);
  assert.match(dhash, /^[0-9a-f]{16}$/);

  const split = splitHex64ToHiLo(phash);
  assert.ok(split);
  assert.equal(typeof deriveBucket16FromHi(split.hi), 'number');
});
