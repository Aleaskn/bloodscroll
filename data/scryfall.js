import * as FileSystem from 'expo-file-system/legacy';

const API_BASE = 'https://api.scryfall.com';

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
