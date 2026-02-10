import * as FileSystem from 'expo-file-system';

const API_BASE = 'https://api.scryfall.com';

function getPrimaryImage(card) {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  return null;
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
  const cacheDir = `${FileSystem.cacheDirectory}cards/`;
  const fileUri = `${cacheDir}${card.id}.jpg`;
  const info = await FileSystem.getInfoAsync(fileUri);
  if (info.exists) return fileUri;
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  await FileSystem.downloadAsync(imageUrl, fileUri);
  return fileUri;
}

export function normalizeCard(card, imageUri) {
  return {
    id: card.id,
    name: card.name,
    mana_cost: card.mana_cost ?? null,
    type_line: card.type_line ?? null,
    oracle_text: card.oracle_text ?? null,
    colors: JSON.stringify(card.colors ?? []),
    color_identity: JSON.stringify(card.color_identity ?? []),
    cmc: card.cmc ?? null,
    legal_commander: card.legalities?.commander === 'legal' ? 1 : 0,
    image_uri: imageUri ?? null,
    set_code: card.set ?? null,
    collector_number: card.collector_number ?? null,
  };
}
