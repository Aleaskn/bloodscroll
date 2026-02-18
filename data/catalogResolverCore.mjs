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
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
  if (!raw) return '';
  const match = raw.match(/^0*([0-9]+)([a-z]?)$/);
  if (!match) return raw;
  return `${Number(match[1])}${match[2]}`;
}

function normalizeSetCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const base = raw.split(/[-_/]/)[0] || raw;
  const compact = base.replace(/[^a-z0-9]/g, '');
  if (compact.length < 2 || compact.length > 6) return '';
  return compact;
}

function sanitizeLine(value) {
  return value
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[^\p{L}\p{N},'\-:/\s]/gu, ' ')
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

function buildSetCodeHints(rawText) {
  if (typeof rawText !== 'string') return [];
  const hints = [];
  const normalized = rawText.toLowerCase();
  for (const match of normalized.matchAll(/\b([a-z0-9]{2,6}(?:[-_][a-z0-9]{2,4})?)\b/g)) {
    const code = normalizeSetCode(match[1]);
    if (code) hints.push(code);
  }
  return uniqueByKey(hints, (value) => value).slice(0, 12);
}

function buildCollectorHints(rawText) {
  if (typeof rawText !== 'string') return [];
  const hints = [];
  const normalized = rawText.toLowerCase().replace(/#/g, ' ');
  for (const match of normalized.matchAll(/\b([0-9]{1,4}[a-z]?)\b/g)) {
    const collector = normalizeCollectorNumber(match[1]);
    if (collector) hints.push(collector);
  }
  return uniqueByKey(hints, (value) => value).slice(0, 16);
}

function tryResolveAmbiguousWithEdition(candidates, editionText) {
  if (!Array.isArray(candidates) || candidates.length < 2 || typeof editionText !== 'string' || !editionText.trim()) {
    return null;
  }

  const setHints = buildSetCodeHints(editionText);
  const collectorHints = buildCollectorHints(editionText);
  const mapped = candidates.map((row) => ({
    row,
    setCode: normalizeSetCode(row?.set_code),
    collector: normalizeCollectorNumber(row?.collector_number),
  }));

  if (setHints.length && collectorHints.length) {
    for (const setHint of setHints) {
      for (const collectorHint of collectorHints) {
        const hit = mapped.filter((entry) => entry.setCode === setHint && entry.collector === collectorHint);
        if (hit.length === 1) return hit[0].row;
      }
    }
  }

  if (setHints.length) {
    for (const setHint of setHints) {
      const hit = mapped.filter((entry) => entry.setCode === setHint);
      if (hit.length === 1) return hit[0].row;
    }
  }

  if (collectorHints.length) {
    for (const collectorHint of collectorHints) {
      const hit = mapped.filter((entry) => entry.collector === collectorHint);
      if (hit.length === 1) return hit[0].row;
    }
  }

  return null;
}

function rowMatchesEditionHints(row, editionText) {
  if (!row || typeof editionText !== 'string' || !editionText.trim()) return false;
  const setHints = buildSetCodeHints(editionText);
  const collectorHints = buildCollectorHints(editionText);
  const rowSet = normalizeSetCode(row?.set_code);
  const rowCollector = normalizeCollectorNumber(row?.collector_number);

  if (setHints.length && collectorHints.length) {
    return setHints.includes(rowSet) && collectorHints.includes(rowCollector);
  }
  if (setHints.length) return setHints.includes(rowSet);
  if (collectorHints.length) return collectorHints.includes(rowCollector);
  return false;
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

  for (const match of normalized.matchAll(
    /\b([0-9]{1,4}[a-z]?)\s+([a-z0-9]{2,6}(?:[-_][a-z0-9]{2,4})?)\b/g
  )) {
    candidates.push({ setCode: match[2], collectorNumber: match[1] });
  }

  for (const match of normalized.matchAll(
    /\b([curmsl])\s*([0-9]{1,4}[a-z]?)\s+([a-z0-9]{2,6}(?:[-_][a-z0-9]{2,4})?)\b/g
  )) {
    candidates.push({ setCode: match[3], collectorNumber: match[2] });
  }

  return uniqueByKey(
    candidates
      .map((entry) => ({
        setCode: normalizeSetCode(entry.setCode),
        collectorNumber: normalizeCollectorNumber(entry.collectorNumber),
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
      const disambiguated = tryResolveAmbiguousWithEdition(exactRows, editionText);
      if (disambiguated) {
        return toMatchedResult(disambiguated, 'name_exact_with_edition_hint', 0.92);
      }
      return toAmbiguousResult(exactRows, 'name_exact', 0.68);
    }

    // eslint-disable-next-line no-await-in-loop
    const fuzzyRows = await repository.searchByNameNormalized(candidate, {
      allowPrefix: true,
      allowContains: false,
      limit: 10,
    });
    if (fuzzyRows.length === 1) {
      if (rowMatchesEditionHints(fuzzyRows[0], editionText)) {
        return toMatchedResult(fuzzyRows[0], 'name_fuzzy_with_edition_hint', 0.79);
      }
      // Avoid wrong auto-open on weak/partial OCR names.
      return toAmbiguousResult(fuzzyRows, 'name_fuzzy_needs_confirmation', 0.5);
    }
    if (fuzzyRows.length > 1) {
      const disambiguated = tryResolveAmbiguousWithEdition(fuzzyRows, editionText);
      if (disambiguated) {
        return toMatchedResult(disambiguated, 'name_fuzzy_with_edition_hint', 0.79);
      }
      return toAmbiguousResult(fuzzyRows, 'name_fuzzy', 0.55);
    }

    // Contains match is even weaker; never auto-open without stronger signals.
    // eslint-disable-next-line no-await-in-loop
    const containsRows = await repository.searchByNameNormalized(candidate, {
      allowPrefix: false,
      allowContains: true,
      limit: 10,
    });
    if (containsRows.length === 1) {
      if (rowMatchesEditionHints(containsRows[0], editionText)) {
        return toMatchedResult(containsRows[0], 'name_contains_with_edition_hint', 0.72);
      }
      return toAmbiguousResult(containsRows, 'name_contains_needs_confirmation', 0.45);
    }
    if (containsRows.length > 1) {
      const disambiguated = tryResolveAmbiguousWithEdition(containsRows, editionText);
      if (disambiguated) {
        return toMatchedResult(disambiguated, 'name_contains_with_edition_hint', 0.72);
      }
      return toAmbiguousResult(containsRows, 'name_contains', 0.4);
    }
  }

  return {
    status: 'none',
  };
}
