const OCR_STOPWORDS = new Set([
  'legendary',
  'creature',
  'sorcery',
  'instant',
  'artifact',
  'enchantment',
  'planeswalker',
  'battle',
  'land',
  'token',
  'basic',
  'snow',
  'tribal',
  'emblem',
  'counter',
  'power',
  'toughness',
]);

function normalizeCollectorNumber(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const match = raw.match(/^0*([0-9]+)([a-z]?)$/);
  if (!match) return raw;
  return `${Number(match[1])}${match[2]}`;
}

function sanitizeLine(value) {
  return value
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[^A-Za-z0-9,'\-:/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyCardNameLine(value) {
  if (!value || value.length < 2 || value.length > 42) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^[a-z0-9]{2,6}\s*[/-]\s*[0-9]{1,4}[a-z]?$/i.test(value)) return false;
  const firstWord = value.split(' ')[0]?.toLowerCase();
  return firstWord && !OCR_STOPWORDS.has(firstWord);
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function uniqueByKey(list, keyGetter) {
  const seen = new Set();
  return list.filter((entry) => {
    const key = keyGetter(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapCandidateRow(row) {
  return {
    id: row.id,
    name: row.name,
    set_code: row.set_code ?? null,
    collector_number: row.collector_number ?? null,
    mana_cost: row.mana_cost ?? null,
    type_line: row.type_line ?? null,
    released_at: row.released_at ?? null,
  };
}

function toAmbiguousResult(candidates, matchedBy, confidence = 0.6) {
  return {
    status: 'ambiguous',
    matchedBy,
    confidence,
    candidates: uniqueByKey(candidates.map(mapCandidateRow), (entry) => entry.id).slice(0, 12),
  };
}

function toMatchedResult(row, matchedBy, confidence) {
  return {
    status: 'matched',
    cardId: row.id,
    matchedBy,
    confidence,
    card: mapCandidateRow(row),
  };
}

export function buildNameCandidatesFromOcrText(rawText) {
  if (typeof rawText !== 'string') return [];

  const lines = rawText
    .split('\n')
    .map((line) => sanitizeLine(line))
    .filter((line) => isLikelyCardNameLine(line));

  const candidates = [];
  for (const line of lines) {
    candidates.push(line);
    candidates.push(toTitleCase(line));
    const splitCard = line.split(' // ')[0];
    if (splitCard && splitCard !== line) {
      candidates.push(splitCard);
      candidates.push(toTitleCase(splitCard));
    }
  }

  return uniqueByKey(candidates, (entry) => entry.toLowerCase()).slice(0, 14);
}

export function buildSetCollectorCandidates(rawText) {
  if (typeof rawText !== 'string') return [];

  const normalized = rawText.toLowerCase();
  const candidates = [];

  for (const match of normalized.matchAll(
    /\b([a-z0-9]{2,6})\s*[-/]\s*([0-9]{1,4}[a-z]?)\b/g
  )) {
    candidates.push({ setCode: match[1], collectorNumber: match[2] });
  }

  for (const match of normalized.matchAll(
    /\b([a-z0-9]{2,6})\s+([0-9]{1,4}[a-z]?)\s*(?:\/\s*[0-9]{1,4})?\b/g
  )) {
    candidates.push({ setCode: match[1], collectorNumber: match[2] });
  }

  return uniqueByKey(
    candidates
      .map((entry) => ({
        setCode: String(entry.setCode ?? '').trim().toLowerCase(),
        collectorNumber: String(entry.collectorNumber ?? '').trim().toLowerCase(),
      }))
      .filter((entry) => entry.setCode && entry.collectorNumber),
    (entry) => `${entry.setCode}:${entry.collectorNumber}`
  ).slice(0, 16);
}

export async function resolveLocalScannedCardWithRepository(
  repository,
  { cardText = '', editionText = '' } = {}
) {
  if (!repository) throw new Error('Missing catalog repository');
  if (typeof repository.findBySetCollector !== 'function') {
    throw new Error('Repository missing findBySetCollector');
  }
  if (typeof repository.searchByNameNormalized !== 'function') {
    throw new Error('Repository missing searchByNameNormalized');
  }

  const mergedText = [editionText, cardText].filter(Boolean).join('\n');

  const setCollectorCandidates = buildSetCollectorCandidates(mergedText);
  for (const candidate of setCollectorCandidates) {
    const variations = uniqueByKey(
      [candidate.collectorNumber, normalizeCollectorNumber(candidate.collectorNumber)].filter(Boolean),
      (entry) => entry
    );

    for (const collectorNumber of variations) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await repository.findBySetCollector(candidate.setCode, collectorNumber);
      if (!rows.length) continue;
      if (rows.length === 1) {
        return toMatchedResult(rows[0], 'set_collector_exact', 0.99);
      }
      return toAmbiguousResult(rows, 'set_collector_exact', 0.82);
    }
  }

  const nameCandidates = buildNameCandidatesFromOcrText(cardText);
  for (const candidate of nameCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const exactRows = await repository.searchByNameNormalized(candidate, {
      allowPrefix: false,
      allowContains: false,
      limit: 10,
    });
    if (exactRows.length === 1) {
      return toMatchedResult(exactRows[0], 'name_exact', 0.9);
    }
    if (exactRows.length > 1) {
      return toAmbiguousResult(exactRows, 'name_exact', 0.68);
    }

    // eslint-disable-next-line no-await-in-loop
    const fuzzyRows = await repository.searchByNameNormalized(candidate, {
      allowPrefix: true,
      allowContains: true,
      limit: 10,
    });
    if (fuzzyRows.length === 1) {
      return toMatchedResult(fuzzyRows[0], 'name_fuzzy', 0.74);
    }
    if (fuzzyRows.length > 1) {
      return toAmbiguousResult(fuzzyRows, 'name_fuzzy', 0.55);
    }
  }

  return {
    status: 'none',
  };
}

