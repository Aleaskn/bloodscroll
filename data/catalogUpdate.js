import * as FileSystem from 'expo-file-system/legacy';
import {
  ensureCatalogReady,
  getCatalogMetaSnapshot,
  replaceCatalogDatabaseWithFile,
  setCatalogMetaSnapshot,
} from './catalogDb';

export const CATALOG_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MANIFEST_URL =
  process.env.EXPO_PUBLIC_CATALOG_MANIFEST_URL ||
  'https://raw.githubusercontent.com/aleaskn/bloodscroll-catalog/main/manifest.json';

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeVersionForFilename(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
}

function normalizeManifestItem(payload) {
  if (!payload || typeof payload !== 'object') return null;

  if (payload.latest && typeof payload.latest === 'object') {
    return normalizeManifestItem(payload.latest);
  }

  const maybeArray = Array.isArray(payload) ? payload : payload.items;
  if (Array.isArray(maybeArray) && maybeArray.length) {
    return normalizeManifestItem(maybeArray[0]);
  }

  const version = payload.version ?? payload.tag ?? payload.id;
  const dbUrl = payload.dbUrl ?? payload.db_url ?? payload.url;

  if (!version || !dbUrl) return null;

  return {
    version: String(version),
    dbUrl: String(dbUrl),
    publishedAt: toIsoDate(payload.publishedAt ?? payload.published_at ?? payload.updatedAt) || null,
    md5: payload.md5 ? String(payload.md5).toLowerCase() : null,
    sha256: payload.sha256 ? String(payload.sha256).toLowerCase() : null,
  };
}

async function fetchManifest(manifestUrl) {
  const response = await fetch(manifestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`Manifest request failed (${response.status})`);
  }
  const payload = await response.json();
  const item = normalizeManifestItem(payload);
  if (!item) {
    throw new Error('Manifest payload is missing required fields');
  }
  return item;
}

async function verifyDownloadedChecksum(fileUri, manifestItem) {
  const downloadInfo = await FileSystem.getInfoAsync(fileUri, { md5: true });
  if (!downloadInfo.exists) {
    throw new Error('Catalog update download missing');
  }

  if (manifestItem.md5 && downloadInfo.md5 !== manifestItem.md5) {
    throw new Error('Catalog checksum mismatch');
  }
}

export async function getCatalogMeta() {
  await ensureCatalogReady();
  return getCatalogMetaSnapshot();
}

export async function setCatalogMeta(metaPatch = {}) {
  await ensureCatalogReady();
  await setCatalogMetaSnapshot(metaPatch);
}

export async function checkForCatalogUpdate({ now = Date.now(), force = false } = {}) {
  await ensureCatalogReady();

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const nowIso = toIsoDate(nowMs) ?? new Date().toISOString();
  const meta = await getCatalogMeta();
  const lastCheckMs = meta.lastCheckAt ? new Date(meta.lastCheckAt).getTime() : 0;

  if (!force && lastCheckMs && nowMs - lastCheckMs < CATALOG_UPDATE_INTERVAL_MS) {
    return {
      status: 'throttled',
      meta,
      nextCheckAt: new Date(lastCheckMs + CATALOG_UPDATE_INTERVAL_MS).toISOString(),
      manifestUrl: meta.manifestUrl || DEFAULT_MANIFEST_URL,
    };
  }

  const manifestUrl = meta.manifestUrl || DEFAULT_MANIFEST_URL;
  await setCatalogMeta({
    lastCheckAt: nowIso,
    manifestUrl,
  });

  try {
    const manifestItem = await fetchManifest(manifestUrl);
    const localVersion = meta.version ?? null;

    if (localVersion && localVersion === manifestItem.version) {
      return {
        status: 'up_to_date',
        localVersion,
        manifestVersion: manifestItem.version,
        manifestItem,
        checkedAt: nowIso,
      };
    }

    return {
      status: 'update_available',
      localVersion,
      manifestVersion: manifestItem.version,
      manifestItem,
      checkedAt: nowIso,
    };
  } catch (error) {
    return {
      status: 'error',
      checkedAt: nowIso,
      reason: error instanceof Error ? error.message : 'Unknown update check error',
    };
  }
}

export async function downloadAndApplyCatalogUpdate(manifestItem) {
  if (!manifestItem?.version || !manifestItem?.dbUrl) {
    throw new Error('Invalid manifest item');
  }

  await ensureCatalogReady();

  const cacheDirectory = `${FileSystem.cacheDirectory}catalog`;
  await FileSystem.makeDirectoryAsync(cacheDirectory, { intermediates: true });
  const tempFile = `${cacheDirectory}/cards-catalog-${sanitizeVersionForFilename(manifestItem.version)}.db`;

  const existing = await FileSystem.getInfoAsync(tempFile);
  if (existing.exists) {
    await FileSystem.deleteAsync(tempFile, { idempotent: true });
  }

  const download = await FileSystem.downloadAsync(manifestItem.dbUrl, tempFile);
  if (download.status >= 400) {
    throw new Error(`Catalog download failed (${download.status})`);
  }

  await verifyDownloadedChecksum(download.uri, manifestItem);
  await replaceCatalogDatabaseWithFile(download.uri);

  await setCatalogMeta({
    version: manifestItem.version,
    source: 'remote',
    updatedAt: new Date().toISOString(),
    publishedAt: manifestItem.publishedAt || null,
  });

  await ensureCatalogReady();

  return {
    status: 'updated',
    version: manifestItem.version,
  };
}

