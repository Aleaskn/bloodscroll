import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNameCandidatesFromOcrText,
  buildSetCollectorCandidates,
  resolveLocalScannedCardWithRepository,
} from '../data/catalogResolverCore.mjs';

test('buildSetCollectorCandidates extracts set code and collector number patterns', () => {
  const text = `Lightning Bolt\nMH3 193/277\nSome extra text`;
  const candidates = buildSetCollectorCandidates(text);
  assert.ok(candidates.some((entry) => entry.setCode === 'mh3' && entry.collectorNumber === '193'));
});

test('buildNameCandidatesFromOcrText keeps likely name lines and title-case variants', () => {
  const text = `legendary creature\nlightning bolt\n123`;
  const candidates = buildNameCandidatesFromOcrText(text);
  assert.ok(candidates.includes('lightning bolt'));
  assert.ok(!candidates.includes('legendary creature'));
});

test('resolveLocalScannedCardWithRepository matches by exact set + collector first', async () => {
  const repository = {
    async findBySetCollector(setCode, collectorNumber) {
      if (setCode === 'mh3' && collectorNumber === '193') {
        return [
          {
            id: 'card_mh3_193',
            name: 'Lightning Bolt',
            set_code: 'mh3',
            collector_number: '193',
          },
        ];
      }
      return [];
    },
    async searchByNameNormalized() {
      return [];
    },
  };

  const result = await resolveLocalScannedCardWithRepository(repository, {
    cardText: 'Lightning Bolt',
    editionText: 'MH3 193',
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.cardId, 'card_mh3_193');
  assert.equal(result.matchedBy, 'set_collector_exact');
});

test('resolveLocalScannedCardWithRepository returns ambiguous when multiple exact name rows', async () => {
  const repository = {
    async findBySetCollector() {
      return [];
    },
    async searchByNameNormalized(name, options) {
      if (name.toLowerCase() === 'lightning bolt' && options.allowPrefix === false) {
        return [
          { id: 'a', name: 'Lightning Bolt', set_code: '2xm', collector_number: '150' },
          { id: 'b', name: 'Lightning Bolt', set_code: 'lea', collector_number: '161' },
        ];
      }
      return [];
    },
  };

  const result = await resolveLocalScannedCardWithRepository(repository, {
    cardText: 'Lightning Bolt',
    editionText: '',
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matchedBy, 'name_exact');
  assert.equal(result.candidates.length, 2);
});

test('resolveLocalScannedCardWithRepository returns none when repository has no match', async () => {
  const repository = {
    async findBySetCollector() {
      return [];
    },
    async searchByNameNormalized() {
      return [];
    },
  };

  const result = await resolveLocalScannedCardWithRepository(repository, {
    cardText: 'Unknown card',
    editionText: 'abc 123',
  });

  assert.deepEqual(result, { status: 'none' });
});
