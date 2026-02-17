import * as FileSystem from 'expo-file-system/legacy';
import {
  defaultDatabaseDirectory,
  importDatabaseFromAssetAsync,
  openDatabaseAsync,
} from 'expo-sqlite';

const CATALOG_DB_NAME = 'cards-catalog.db';
const CATALOG_ASSET_ID = require('../assets/catalog/cards-catalog.db');

const META_KEYS = {
  version: 'catalog_version',
  source: 'catalog_source',
  updatedAt: 'catalog_updated_at',
  lastCheckAt: 'catalog_last_check_at',
  manifestUrl: 'catalog_manifest_url',
  publishedAt: 'catalog_published_at',
};

let catalogDbPromise = null;

function normalizeDirectoryPath(value) {
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeCollectorNumber(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const match = raw.match(/^0*([0-9]+)([a-z]?)$/);
  if (!match) return raw;
  return `${Number(match[1])}${match[2]}`;
}

function escapeLike(value) {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export function normalizeCatalogName(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCatalogDbName() {
  return CATALOG_DB_NAME;
}

export function getCatalogDbDirectory() {
  return normalizeDirectoryPath(defaultDatabaseDirectory);
}

export function getCatalogDbPath() {
  return `${getCatalogDbDirectory()}${CATALOG_DB_NAME}`;
}

async function ensureCatalogDirectory() {
  await FileSystem.makeDirectoryAsync(getCatalogDbDirectory(), { intermediates: true });
}

async function getFileInfo(uri, withMd5 = false) {
  return FileSystem.getInfoAsync(uri, withMd5 ? { md5: true } : undefined);
}

async function importBundledCatalogIfMissing() {
  await ensureCatalogDirectory();
  const existing = await getFileInfo(getCatalogDbPath());
  if (existing.exists) return;
  try {
    await importDatabaseFromAssetAsync(CATALOG_DB_NAME, {
      assetId: CATALOG_ASSET_ID,
      forceOverwrite: false,
    });
  } catch {
    // If import fails we fallback to schema bootstrap below.
  }
}

async function ensureCatalogSchema(db) {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS catalog_cards (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      name_norm TEXT NOT NULL,
      set_code TEXT,
      collector_number TEXT,
      mana_cost TEXT,
      type_line TEXT,
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_cards_name_norm ON catalog_cards(name_norm);
    CREATE INDEX IF NOT EXISTS idx_catalog_cards_set_collector ON catalog_cards(set_code, collector_number);
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );`
  );
}

async function getCatalogDb() {
  if (catalogDbPromise) return catalogDbPromise;

  catalogDbPromise = (async () => {
    await importBundledCatalogIfMissing();
    const db = await openDatabaseAsync(CATALOG_DB_NAME);
    await ensureCatalogSchema(db);
    return db;
  })();

  return catalogDbPromise;
}

export async function closeCatalogDb() {
  if (!catalogDbPromise) return;
  try {
    const db = await catalogDbPromise;
    await db.closeAsync();
  } catch {
    // noop
  } finally {
    catalogDbPromise = null;
  }
}

export async function ensureCatalogReady() {
  await getCatalogDb();
}

export async function getCatalogCardById(cardId) {
  if (!cardId) return null;
  const db = await getCatalogDb();
  const row = await db.getFirstAsync(
    `SELECT id, name, name_norm, set_code, collector_number, mana_cost, type_line, released_at
     FROM catalog_cards
     WHERE id = ?
     LIMIT 1;`,
    [String(cardId)]
  );
  return row || null;
}

export async function findBySetCollector(setCode, collectorNumber) {
  const set = String(setCode ?? '').trim().toLowerCase();
  const collectorRaw = String(collectorNumber ?? '').trim().toLowerCase();
  if (!set || !collectorRaw) return [];
  const collector = normalizeCollectorNumber(collectorRaw);

  const db = await getCatalogDb();
  const rows = await db.getAllAsync(
    `SELECT id, name, set_code, collector_number, mana_cost, type_line, released_at
     FROM catalog_cards
     WHERE set_code = ?
       AND (collector_number = ? OR collector_number = ?)
     ORDER BY released_at DESC
     LIMIT 20;`,
    [set, collectorRaw, collector]
  );

  return rows ?? [];
}

export async function searchByNameNormalized(
  name,
  { allowPrefix = true, allowContains = true, limit = 12 } = {}
) {
  const normalized = normalizeCatalogName(name);
  if (!normalized) return [];

  const db = await getCatalogDb();
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const exactRows = await db.getAllAsync(
    `SELECT id, name, set_code, collector_number, mana_cost, type_line, released_at
     FROM catalog_cards
     WHERE name_norm = ?
     ORDER BY released_at DESC
     LIMIT ?;`,
    [normalized, normalizedLimit]
  );
  if (exactRows?.length) return exactRows;

  if (allowPrefix) {
    const prefixPattern = `${escapeLike(normalized)}%`;
    const prefixRows = await db.getAllAsync(
      `SELECT id, name, set_code, collector_number, mana_cost, type_line, released_at
       FROM catalog_cards
       WHERE name_norm LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN name_norm = ? THEN 0 ELSE 1 END, released_at DESC
       LIMIT ?;`,
      [prefixPattern, normalized, normalizedLimit]
    );
    if (prefixRows?.length) return prefixRows;
  }

  if (allowContains) {
    const containsPattern = `%${escapeLike(normalized)}%`;
    const containsRows = await db.getAllAsync(
      `SELECT id, name, set_code, collector_number, mana_cost, type_line, released_at
       FROM catalog_cards
       WHERE name_norm LIKE ? ESCAPE '\\'
       ORDER BY released_at DESC
       LIMIT ?;`,
      [containsPattern, normalizedLimit]
    );
    return containsRows ?? [];
  }

  return [];
}

export async function getCatalogMetaValue(key) {
  if (!key) return null;
  const db = await getCatalogDb();
  const row = await db.getFirstAsync('SELECT value FROM catalog_meta WHERE key = ? LIMIT 1;', [key]);
  return row?.value ?? null;
}

export async function setCatalogMetaValue(key, value) {
  if (!key) return;
  const db = await getCatalogDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?);',
    [key, value == null ? null : String(value)]
  );
}

export async function getCatalogMetaSnapshot() {
  const [version, source, updatedAt, lastCheckAt, manifestUrl, publishedAt] = await Promise.all([
    getCatalogMetaValue(META_KEYS.version),
    getCatalogMetaValue(META_KEYS.source),
    getCatalogMetaValue(META_KEYS.updatedAt),
    getCatalogMetaValue(META_KEYS.lastCheckAt),
    getCatalogMetaValue(META_KEYS.manifestUrl),
    getCatalogMetaValue(META_KEYS.publishedAt),
  ]);

  return {
    version,
    source,
    updatedAt,
    lastCheckAt,
    manifestUrl,
    publishedAt,
  };
}

export async function setCatalogMetaSnapshot(patch = {}) {
  const entries = Object.entries({
    [META_KEYS.version]: patch.version,
    [META_KEYS.source]: patch.source,
    [META_KEYS.updatedAt]: patch.updatedAt,
    [META_KEYS.lastCheckAt]: patch.lastCheckAt,
    [META_KEYS.manifestUrl]: patch.manifestUrl,
    [META_KEYS.publishedAt]: patch.publishedAt,
  }).filter(([, value]) => value != null);

  for (const [key, value] of entries) {
    // eslint-disable-next-line no-await-in-loop
    await setCatalogMetaValue(key, value);
  }
}

export async function replaceCatalogDatabaseWithFile(sourceFileUri) {
  if (!sourceFileUri) throw new Error('Missing source catalog database file');

  await closeCatalogDb();
  await ensureCatalogDirectory();

  const catalogPath = getCatalogDbPath();
  const backupPath = `${catalogPath}.bak`;

  const backupInfo = await getFileInfo(backupPath);
  if (backupInfo.exists) {
    await FileSystem.deleteAsync(backupPath, { idempotent: true });
  }

  const currentInfo = await getFileInfo(catalogPath);
  const hasCurrent = currentInfo.exists;

  if (hasCurrent) {
    await FileSystem.moveAsync({ from: catalogPath, to: backupPath });
  }

  try {
    await FileSystem.moveAsync({ from: sourceFileUri, to: catalogPath });
    await FileSystem.deleteAsync(backupPath, { idempotent: true });
  } catch (error) {
    const dbInfo = await getFileInfo(catalogPath);
    if (dbInfo.exists) {
      await FileSystem.deleteAsync(catalogPath, { idempotent: true });
    }
    const oldInfo = await getFileInfo(backupPath);
    if (oldInfo.exists) {
      await FileSystem.moveAsync({ from: backupPath, to: catalogPath });
    }
    throw error;
  }
}

