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

test('buildSetCollectorCandidates supports collector-first OCR pattern and language suffixes', () => {
  const text = `0246 CMM-EN\nrandom text`;
  const candidates = buildSetCollectorCandidates(text);
  assert.ok(candidates.some((entry) => entry.setCode === 'cmm' && entry.collectorNumber === '246'));
});

test('buildSetCollectorCandidates supports rarity + collector + set OCR pattern', () => {
  const text = `M 0096 BLC EN`;
  const candidates = buildSetCollectorCandidates(text);
  assert.ok(candidates.some((entry) => entry.setCode === 'blc' && entry.collectorNumber === '96'));
});

test('buildNameCandidatesFromOcrText keeps likely name lines and title-case variants', () => {
  const text = `legendary creature\nlightning bolt\n123`;
  const candidates = buildNameCandidatesFromOcrText(text);
  assert.ok(candidates.includes('lightning bolt'));
  assert.ok(!candidates.includes('legendary creature'));
});

test('buildNameCandidatesFromOcrText keeps non-latin names (japanese)', () => {
  const text = `伝国の玉璽\n伝国の玉璽`;
  const candidates = buildNameCandidatesFromOcrText(text);
  assert.ok(candidates.some((entry) => entry.includes('伝国')));
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

test('resolveLocalScannedCardWithRepository auto-disambiguates by edition hint when exact name has multiple rows', async () => {
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
    editionText: '161 LEA-EN',
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.cardId, 'b');
  assert.equal(result.matchedBy, 'name_exact_with_edition_hint');
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

test('resolveLocalScannedCardWithRepository does not auto-open single fuzzy row without edition hint', async () => {
  const repository = {
    async findBySetCollector() {
      return [];
    },
    async searchByNameNormalized(name, options) {
      if (options.allowPrefix === false && options.allowContains === false) return [];
      if (options.allowPrefix === true && options.allowContains === false) {
        return [{ id: 'x', name: 'Nissa, Who Shakes the World', set_code: 'war', collector_number: '169' }];
      }
      return [];
    },
  };

  const result = await resolveLocalScannedCardWithRepository(repository, {
    cardText: 'nissa who shakes worl',
    editionText: '',
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.matchedBy, 'name_fuzzy_needs_confirmation');
  assert.equal(result.candidates.length, 1);
});

test('resolveLocalScannedCardWithRepository auto-opens single fuzzy row when edition hint matches', async () => {
  const repository = {
    async findBySetCollector() {
      return [];
    },
    async searchByNameNormalized(name, options) {
      if (options.allowPrefix === false && options.allowContains === false) return [];
      if (options.allowPrefix === true && options.allowContains === false) {
        return [{ id: 'x', name: 'Nissa, Who Shakes the World', set_code: 'blc', collector_number: '96' }];
      }
      return [];
    },
  };

  const result = await resolveLocalScannedCardWithRepository(repository, {
    cardText: 'nissa who shakes worl',
    editionText: 'M 0096 BLC EN',
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.cardId, 'x');
  assert.equal(result.matchedBy, 'name_fuzzy_with_edition_hint');
});
