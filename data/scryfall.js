import * as FileSystem from 'expo-file-system/legacy';

const API_BASE = 'https://api.scryfall.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
]);

function getPrimaryImage(card) {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
}

function getPrimaryArtImage(card) {
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  if (card.card_faces?.[0]?.image_uris?.art_crop) return card.card_faces[0].image_uris.art_crop;
  return null;
}

async function cacheImageFromUrl(url, fileUri) {
  if (!url) return null;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (info.exists) return fileUri;
  const folder = fileUri.split('/').slice(0, -1).join('/') + '/';
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  await FileSystem.downloadAsync(url, fileUri);
  return fileUri;
}

async function fetchCardById(cardId) {
  const res = await fetch(`${API_BASE}/cards/${cardId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getCardById(cardId) {
  return fetchCardById(cardId);
}

async function fetchCardByPath(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchCardByFuzzyName(name) {
  const res = await fetch(`${API_BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  if (!res.ok) return null;
  return res.json();
}

function normalizeScanInput(rawValue) {
  if (typeof rawValue !== 'string') return '';
  return rawValue.trim();
}

function parseScryfallSetCollector(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.includes('scryfall.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const cardIndex = parts.indexOf('card');
    if (cardIndex === -1) return null;
    const setCode = parts[cardIndex + 1];
    const collectorNumber = parts[cardIndex + 2];
    if (!setCode || !collectorNumber) return null;
    return { setCode, collectorNumber };
  } catch {
    return null;
  }
}

async function tryExactNameLookup(value) {
  const exactQuery = `!"${value.replace(/"/g, '\\"')}"`;
  const list = await searchCards(exactQuery);
  return list?.[0] ?? null;
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildNameCandidatesFromOcr(rawText) {
  if (typeof rawText !== 'string') return [];
  const lines = rawText
    .split('\n')
    .map((line) => line.replace(/[^A-Za-z0-9,'’\-:\s/]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3 && line.length <= 42)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => {
      const firstWord = line.split(' ')[0]?.toLowerCase();
      return firstWord && !OCR_STOPWORDS.has(firstWord);
    });

  const candidates = [];
  for (const line of lines) {
    candidates.push(line);
    candidates.push(toTitleCase(line));
    const splitCandidate = line.split(' // ')[0];
    if (splitCandidate && splitCandidate !== line) {
      candidates.push(splitCandidate);
      candidates.push(toTitleCase(splitCandidate));
    }
  }

  return [...new Set(candidates)].slice(0, 12);
}

function buildSetCollectorCandidatesFromOcr(rawText) {
  if (typeof rawText !== 'string') return [];
  const normalized = rawText.toLowerCase();
  const candidates = [];

  const slashMatches = normalized.matchAll(/([a-z0-9]{2,6})\s*[-/]\s*([0-9]{1,4}[a-z]?)/g);
  for (const match of slashMatches) {
    candidates.push({ setCode: match[1], collectorNumber: match[2] });
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const setToken = tokens[i];
    const collectorToken = tokens[i + 1];
    if (!/^[a-z0-9]{2,6}$/.test(setToken)) continue;
    if (!/^[0-9]{1,4}[a-z]?$/.test(collectorToken)) continue;
    candidates.push({ setCode: setToken, collectorNumber: collectorToken });
  }

  const seen = new Set();
  return candidates.filter((entry) => {
    const key = `${entry.setCode}:${entry.collectorNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 14);
}

export async function resolveScannedCardFromOcr(rawText) {
  const setCollectorCandidates = buildSetCollectorCandidatesFromOcr(rawText);
  for (const candidate of setCollectorCandidates) {
    const bySetCollector = await fetchCardByPath(
      `/cards/${encodeURIComponent(candidate.setCode)}/${encodeURIComponent(candidate.collectorNumber)}`
    );
    if (bySetCollector?.id) return bySetCollector;
  }

  const candidates = buildNameCandidatesFromOcr(rawText);
  for (const candidate of candidates) {
    const fuzzy = await fetchCardByFuzzyName(candidate);
    if (fuzzy?.id) return fuzzy;
    const exact = await tryExactNameLookup(candidate);
    if (exact?.id) return exact;
  }
  return null;
}

export async function resolveScannedCard(rawValue) {
  const value = normalizeScanInput(rawValue);
  if (!value) return null;

  if (UUID_RE.test(value)) {
    return fetchCardById(value);
  }

  const parsedUrl = parseScryfallSetCollector(value);
  if (parsedUrl) {
    const fromPath = await fetchCardByPath(
      `/cards/${encodeURIComponent(parsedUrl.setCode)}/${encodeURIComponent(parsedUrl.collectorNumber)}`
    );
    if (fromPath) return fromPath;
  }

  const plainSetCollector = value.match(/^([a-z0-9]{2,6})[-:/\s]([a-z0-9]+)$/i);
  if (plainSetCollector) {
    const fromPath = await fetchCardByPath(
      `/cards/${encodeURIComponent(plainSetCollector[1])}/${encodeURIComponent(plainSetCollector[2])}`
    );
    if (fromPath) return fromPath;
  }

  return tryExactNameLookup(value);
}

export async function searchCards(query) {
  const url = `${API_BASE}/cards/search?q=${encodeURIComponent(query)}&unique=cards`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();
  return data.data || [];
}

export async function autocomplete(query) {
  const url = `${API_BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Autocomplete failed');
  const data = await res.json();
  return data.data || [];
}

export async function getCachedImageUri(card) {
  const imageUrl = getPrimaryImage(card);
  if (!imageUrl) return null;
  const fileUri = `${FileSystem.cacheDirectory}cards/${card.id}.jpg`;
  return cacheImageFromUrl(imageUrl, fileUri);
}

export async function getCachedArtImageUri(card) {
  const imageUrl = getPrimaryArtImage(card);
  if (!imageUrl) return null;
  const fileUri = `${FileSystem.cacheDirectory}cards/art_${card.id}.jpg`;
  return cacheImageFromUrl(imageUrl, fileUri);
}

export async function ensureCardImage(card) {
  if (card?.image_uri) {
    return card.image_uri;
  }
  try {
    const fullCard = await fetchCardById(card.id);
    if (!fullCard) return null;
    return getCachedImageUri(fullCard);
  } catch {
    return null;
  }
}

export async function getCachedCardFaceImageUris(cardId) {
  if (!cardId) return [];
  try {
    const fullCard = await fetchCardById(cardId);
    const faceImages = fullCard?.card_faces
      ?.map((face) => face?.image_uris?.normal)
      .filter(Boolean);

    if (!faceImages || faceImages.length < 2) return [];

    const cached = await Promise.all(
      faceImages.map((url, index) =>
        cacheImageFromUrl(url, `${FileSystem.cacheDirectory}cards/${cardId}_face_${index}.jpg`)
      )
    );
    return cached.filter(Boolean);
  } catch {
    return [];
  }
}

export async function getCachedCardFaces(cardId) {
  if (!cardId) return [];
  try {
    const fullCard = await fetchCardById(cardId);
    if (!fullCard?.card_faces || fullCard.card_faces.length < 2) return [];

    const faces = await Promise.all(
      fullCard.card_faces.map(async (face, index) => {
        const imageUrl = face?.image_uris?.normal ?? null;
        const cachedUri = await cacheImageFromUrl(
          imageUrl,
          `${FileSystem.cacheDirectory}cards/${cardId}_face_${index}.jpg`
        );
        return {
          name: face?.name ?? null,
          type_line: face?.type_line ?? null,
          oracle_text: face?.oracle_text ?? null,
          mana_cost: face?.mana_cost ?? null,
          image_uri: cachedUri ?? imageUrl,
        };
      })
    );

    return faces;
  } catch {
    return [];
  }
}

export function normalizeCard(card, imageUri, artImageUri) {
  const fallbackManaCost = card.card_faces?.map((face) => face?.mana_cost).filter(Boolean).join(' // ');

  return {
    id: card.id,
    name: card.name,
    mana_cost: card.mana_cost ?? fallbackManaCost ?? null,
    type_line: card.type_line ?? null,
    oracle_text: card.oracle_text ?? null,
    colors: JSON.stringify(card.colors ?? []),
    color_identity: JSON.stringify(card.color_identity ?? []),
    cmc: card.cmc ?? null,
    legal_commander: card.legalities?.commander === 'legal' ? 1 : 0,
    image_uri: imageUri ?? null,
    art_image_uri: artImageUri ?? null,
    set_code: card.set ?? null,
    collector_number: card.collector_number ?? null,
  };
}
