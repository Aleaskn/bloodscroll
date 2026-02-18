import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHex64ToHiLo } from '../data/fingerprintCore.mjs';
import { resolveByFingerprintWithRepository } from '../data/fingerprintResolverCore.mjs';

function buildFp(hexA, hexB, overrides = {}) {
  const p = splitHex64ToHiLo(hexA);
  const d = splitHex64ToHiLo(hexB);
  if (!p || !d) throw new Error('invalid test fingerprint');
  return {
    phash_hi: p.hi,
    phash_lo: p.lo,
    dhash_hi: d.hi,
    dhash_lo: d.lo,
    bucket16: (p.hi >>> 16) & 0xffff,
    ...overrides,
  };
}

test('resolveByFingerprintWithRepository returns matched for strong exact candidate', async () => {
  const input = buildFp('0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0');
  const repository = {
    async searchFingerprintCandidatesByBucket() {
      return [
        {
          card_id: 'card-1',
          name: 'Lightning Bolt',
          set_code: 'mh3',
          collector_number: '193',
          phash_hi: input.phash_hi,
          phash_lo: input.phash_lo,
          dhash_hi: input.dhash_hi,
          dhash_lo: input.dhash_lo,
        },
      ];
    },
  };

  const result = await resolveByFingerprintWithRepository(repository, input);
  assert.equal(result.status, 'matched');
  assert.equal(result.cardId, 'card-1');
  assert.equal(result.matchedBy, 'fingerprint_exact');
});

test('resolveByFingerprintWithRepository uses edition hint to disambiguate', async () => {
  const input = buildFp('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', {
    editionText: 'M 0096 BLC EN',
  });
  const baseCandidate = {
    name: 'Nissa, Who Shakes the World',
    phash_hi: input.phash_hi,
    phash_lo: input.phash_lo,
    dhash_hi: input.dhash_hi,
    dhash_lo: input.dhash_lo,
  };
  const repository = {
    async searchFingerprintCandidatesByBucket() {
      return [
        {
          ...baseCandidate,
          card_id: 'nissa-wrong',
          set_code: 'war',
          collector_number: '169',
        },
        {
          ...baseCandidate,
          card_id: 'nissa-blc-96',
          set_code: 'blc',
          collector_number: '96',
        },
      ];
    },
  };

  const result = await resolveByFingerprintWithRepository(repository, input);
  assert.equal(result.status, 'matched');
  assert.equal(result.cardId, 'nissa-blc-96');
  assert.ok(
    ['fingerprint_with_edition_hint', 'fingerprint_exact'].includes(result.matchedBy),
    `unexpected matchedBy: ${result.matchedBy}`
  );
});

test('resolveByFingerprintWithRepository returns none when fingerprint payload is invalid', async () => {
  const repository = {
    async searchFingerprintCandidatesByBucket() {
      return [];
    },
  };
  const result = await resolveByFingerprintWithRepository(repository, {
    phash_hi: NaN,
    phash_lo: 0,
    dhash_hi: 0,
    dhash_lo: 0,
    bucket16: 0,
  });
  assert.deepEqual(result, { status: 'none', reason: 'fingerprint_unavailable' });
});
