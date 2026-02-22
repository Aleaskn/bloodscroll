#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  computeDHash64FromGrayscale,
  computePHash64FromGrayscale,
  deriveBucket16FromHi,
  normalizeGrayscaleContrast,
  rgbaToGrayscale,
  splitHex64ToHiLo,
} from '../data/fingerprintCore.mjs';

let jpegModulePromise = null;

async function loadJpegModule(required = false) {
  if (jpegModulePromise) return jpegModulePromise;
  jpegModulePromise = import('jpeg-js')
    .then((module) => module?.default ?? module)
    .catch(() => null);

  const loaded = await jpegModulePromise;
  if (!loaded && required) {
    throw new Error('Missing dependency: jpeg-js. Run `npm install` before `npm run catalog:build`.');
  }
  return loaded;
}

const DEFAULT_OUTPUT_DB = resolve(process.cwd(), 'assets/catalog/cards-catalog.db');
const DEFAULT_OUTPUT_MANIFEST = resolve(process.cwd(), 'assets/catalog/catalog-manifest.local.json');

function parseArgs(argv) {
  const args = {
    input: '',
    output: DEFAULT_OUTPUT_DB,
    manifest: DEFAULT_OUTPUT_MANIFEST,
    withFingerprints: true,
    fingerprintLimit: 0,
    progressEvery: 500,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input') {
      args.input = argv[i + 1] ?? '';
      i += 1;
    } else if (token === '--output') {
      args.output = resolve(process.cwd(), argv[i + 1] ?? DEFAULT_OUTPUT_DB);
      i += 1;
    } else if (token === '--manifest') {
      args.manifest = resolve(process.cwd(), argv[i + 1] ?? DEFAULT_OUTPUT_MANIFEST);
      i += 1;
    } else if (token === '--no-fingerprints') {
      args.withFingerprints = false;
    } else if (token === '--fingerprint-limit') {
      args.fingerprintLimit = Math.max(0, Number(argv[i + 1] ?? 0) || 0);
      i += 1;
    } else if (token === '--progress-every') {
      args.progressEvery = Math.max(1, Number(argv[i + 1] ?? 500) || 500);
      i += 1;
    } else if (token === '--help' || token === '-h') {
      printHelpAndExit(0);
    }
  }

  return args;
}

function printHelpAndExit(code = 0) {
  console.log(`Usage:
  node scripts/build-catalog-db.mjs [--input /path/default_cards.json] [--output assets/catalog/cards-catalog.db]

Options:
  --input     Optional local Scryfall default_cards JSON path.
              If omitted, script downloads current default_cards bulk metadata + payload.
  --output    SQLite output path (default: assets/catalog/cards-catalog.db).
  --manifest  Local manifest output path (default: assets/catalog/catalog-manifest.local.json).
  --no-fingerprints     Skip image fingerprint generation.
  --fingerprint-limit N Generate fingerprints for first N cards (0 = all).
  --progress-every N    Print progress every N fingerprint rows (default: 500).
`);
  process.exit(code);
}

function runSqlite(dbPath, script) {
  const result = spawnSync('sqlite3', [dbPath], {
    input: script,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = result.stderr || 'unknown sqlite3 error';
    throw new Error(`sqlite3 failed: ${stderr}`);
  }
}

function normalizeCatalogName(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTsv(value) {
  return String(value ?? '')
    .replace(/\t/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/"/g, "'")
    .trim();
}

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

function pickCardFields(card) {
  return {
    id: sanitizeTsv(card.id),
    name: sanitizeTsv(card.name),
    name_norm: sanitizeTsv(normalizeCatalogName(card.name)),
    set_code: sanitizeTsv(String(card.set ?? '').toLowerCase()),
    collector_number: sanitizeTsv(String(card.collector_number ?? '').toLowerCase()),
    mana_cost: sanitizeTsv(card.mana_cost ?? ''),
    type_line: sanitizeTsv(card.type_line ?? ''),
    released_at: sanitizeTsv(card.released_at ?? ''),
  };
}

function getCardArtSources(card) {
  const sources = [];
  if (card?.image_uris?.normal) {
    sources.push({ url: String(card.image_uris.normal), source: 'normal' });
  }
  if (card?.image_uris?.art_crop) {
    sources.push({ url: String(card.image_uris.art_crop), source: 'art_crop' });
  }
  if (Array.isArray(card?.card_faces)) {
    for (const face of card.card_faces) {
      if (face?.image_uris?.normal) {
        sources.push({ url: String(face.image_uris.normal), source: 'normal' });
      }
      if (face?.image_uris?.art_crop) {
        sources.push({ url: String(face.image_uris.art_crop), source: 'art_crop' });
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (const entry of sources) {
    const key = `${entry.source}|${entry.url}`;
    if (!entry.url || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

async function writeCatalogTsvs(cards, cardsTsvPath, aliasesTsvPath) {
  const cardsStream = createWriteStream(cardsTsvPath, { encoding: 'utf8' });
  const aliasesStream = createWriteStream(aliasesTsvPath, { encoding: 'utf8' });
  const englishRows = [];

  for (const card of cards) {
    if (!card || card.object !== 'card') continue;
    if (!card.id || !card.name) continue;
    if (card.lang && card.lang !== 'en') continue;

    const row = pickCardFields(card);
    if (!row.name_norm) continue;

    const line = [
      row.id,
      row.name,
      row.name_norm,
      row.set_code,
      row.collector_number,
      row.mana_cost,
      row.type_line,
      row.released_at,
    ].join('\t');

    if (!cardsStream.write(`${line}\n`)) {
      await once(cardsStream, 'drain');
    }

    englishRows.push({
      id: row.id,
      set_code: row.set_code,
      collector_number: normalizeCollectorNumber(row.collector_number),
      oracle_id: sanitizeTsv(card.oracle_id ?? ''),
      lang: sanitizeTsv(card.lang ?? 'en') || 'en',
      art_variant: sanitizeTsv(card.finishes?.join(',') || card.border_color || ''),
      art_sources: getCardArtSources(card),
      aliases: [
        row.name_norm,
        normalizeCatalogName(card.printed_name ?? ''),
        normalizeCatalogName(card.flavor_name ?? ''),
      ],
    });
  }

  cardsStream.end();
  await once(cardsStream, 'finish');

  const englishByOracle = new Map();
  const englishBySetCollector = new Map();
  const englishByOracleSetCollector = new Map();
  for (const row of englishRows) {
    if (row.oracle_id && !englishByOracle.has(row.oracle_id)) {
      englishByOracle.set(row.oracle_id, row.id);
    }
    const scKey = `${row.set_code}|${row.collector_number}`;
    if (row.set_code && row.collector_number && !englishBySetCollector.has(scKey)) {
      englishBySetCollector.set(scKey, row.id);
    }
    const oscKey = `${row.oracle_id}|${row.set_code}|${row.collector_number}`;
    if (row.oracle_id && row.set_code && row.collector_number && !englishByOracleSetCollector.has(oscKey)) {
      englishByOracleSetCollector.set(oscKey, row.id);
    }
  }

  const aliasSeen = new Set();
  async function writeAlias(aliasNorm, cardId) {
    if (!aliasNorm || !cardId) return;
    const key = `${aliasNorm}|${cardId}`;
    if (aliasSeen.has(key)) return;
    aliasSeen.add(key);
    if (!aliasesStream.write(`${sanitizeTsv(aliasNorm)}\t${sanitizeTsv(cardId)}\n`)) {
      await once(aliasesStream, 'drain');
    }
  }

  for (const row of englishRows) {
    for (const alias of row.aliases) {
      await writeAlias(alias, row.id);
    }
  }

  for (const card of cards) {
    if (!card || card.object !== 'card') continue;
    if (card.lang === 'en') continue;

    const setCode = sanitizeTsv(String(card.set ?? '').toLowerCase());
    const collector = normalizeCollectorNumber(card.collector_number);
    const oracleId = sanitizeTsv(card.oracle_id ?? '');
    let targetId = '';

    if (oracleId && setCode && collector) {
      targetId = englishByOracleSetCollector.get(`${oracleId}|${setCode}|${collector}`) || '';
    }
    if (!targetId && oracleId) {
      targetId = englishByOracle.get(oracleId) || '';
    }
    if (!targetId && setCode && collector) {
      targetId = englishBySetCollector.get(`${setCode}|${collector}`) || '';
    }
    if (!targetId) continue;

    const aliases = [
      normalizeCatalogName(card.name ?? ''),
      normalizeCatalogName(card.printed_name ?? ''),
      normalizeCatalogName(card.flavor_name ?? ''),
    ];
    for (const alias of aliases) {
      await writeAlias(alias, targetId);
    }
  }

  aliasesStream.end();
  await once(aliasesStream, 'finish');

  return {
    cards: englishRows.length,
    aliases: aliasSeen.size,
    englishRows,
  };
}

function resizeGrayscaleNearest(gray, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Uint8Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.round((y / dstHeight) * srcHeight));
    for (let x = 0; x < dstWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.round((x / dstWidth) * srcWidth));
      out[y * dstWidth + x] = gray[srcY * srcWidth + srcX];
    }
  }
  return out;
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function cropGrayscale(gray, width, height, frame) {
  const left = clamp01(frame.leftInCard, 0);
  const top = clamp01(frame.topInCard, 0);
  const w = clamp01(frame.widthInCard, 1);
  const h = clamp01(frame.heightInCard, 1);
  const originX = Math.max(0, Math.round(width * left));
  const originY = Math.max(0, Math.round(height * top));
  const cropWidth = Math.max(1, Math.min(Math.round(width * w), width - originX));
  const cropHeight = Math.max(1, Math.min(Math.round(height * h), height - originY));
  const out = new Uint8Array(cropWidth * cropHeight);
  for (let y = 0; y < cropHeight; y += 1) {
    const srcStart = (originY + y) * width + originX;
    const dstStart = y * cropWidth;
    out.set(gray.subarray(srcStart, srcStart + cropWidth), dstStart);
  }
  return { gray: out, width: cropWidth, height: cropHeight };
}

function buildFullCardFramesForNormal() {
  const base = { leftInCard: 0.02, topInCard: 0.02, widthInCard: 0.96, heightInCard: 0.96 };
  const variants = [
    { ...base, tag: 'normal_base' },
    { ...base, leftInCard: 0.0, tag: 'normal_left' },
    { ...base, leftInCard: 0.04, tag: 'normal_right' },
    { ...base, topInCard: 0.0, tag: 'normal_up' },
    { ...base, topInCard: 0.04, tag: 'normal_down' },
    { ...base, leftInCard: 0.03, topInCard: 0.03, widthInCard: 0.94, heightInCard: 0.94, tag: 'normal_tight' },
  ];
  return variants.map((entry) => ({
    ...entry,
    leftInCard: clamp01(entry.leftInCard, base.leftInCard),
    topInCard: clamp01(entry.topInCard, base.topInCard),
    widthInCard: clamp01(entry.widthInCard, base.widthInCard),
    heightInCard: clamp01(entry.heightInCard, base.heightInCard),
  }));
}

function computeFingerprintFromGrayscale(gray, width, height) {
  const normalized = normalizeGrayscaleContrast(gray);
  const pInput = resizeGrayscaleNearest(normalized, width, height, 32, 32);
  const dInput = resizeGrayscaleNearest(normalized, width, height, 9, 8);
  const phash64 = computePHash64FromGrayscale(pInput, 32, 32);
  const dhash64 = computeDHash64FromGrayscale(dInput, 9, 8);
  const pSplit = splitHex64ToHiLo(phash64);
  const dSplit = splitHex64ToHiLo(dhash64);
  if (!pSplit || !dSplit) return null;
  return {
    phash_hi: pSplit.hi,
    phash_lo: pSplit.lo,
    dhash_hi: dSplit.hi,
    dhash_lo: dSplit.lo,
    bucket16: deriveBucket16FromHi(pSplit.hi),
  };
}

function computeFingerprintFromJpegBuffer(buffer, jpeg, sourceType = 'art_crop') {
  const decoded = jpeg.decode(buffer, { useTArray: true });
  if (!decoded?.width || !decoded?.height || !decoded?.data) return [];
  const gray = rgbaToGrayscale(decoded.data, decoded.width, decoded.height);
  if (!gray.length) return [];

  if (sourceType === 'normal') {
    const fingerprints = [];
    for (const frame of buildFullCardFramesForNormal()) {
      const cropped = cropGrayscale(gray, decoded.width, decoded.height, frame);
      const fp = computeFingerprintFromGrayscale(cropped.gray, cropped.width, cropped.height);
      if (fp) {
        fingerprints.push({
          ...fp,
          sourceVariant: frame.tag,
        });
      }
    }
    return fingerprints;
  }

  // Keep art-crop fallback only for printings without normal image.
  const fp = computeFingerprintFromGrayscale(gray, decoded.width, decoded.height);
  return fp ? [{ ...fp, sourceVariant: 'art_crop_fallback' }] : [];
}

async function fetchBinary(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function writeFingerprintTsv(
  englishRows,
  fingerprintTsvPath,
  { withFingerprints = true, fingerprintLimit = 0, jpeg = null, progressEvery = 500 } = {}
) {
  const stream = createWriteStream(fingerprintTsvPath, { encoding: 'utf8' });
  if (!withFingerprints) {
    stream.end();
    await once(stream, 'finish');
    return 0;
  }

  const cache = new Map();
  let count = 0;
  const maxRows = fingerprintLimit > 0 ? Math.min(fingerprintLimit, englishRows.length) : englishRows.length;
  const startedAt = Date.now();

  for (let i = 0; i < maxRows; i += 1) {
    const row = englishRows[i];
    const allSources = Array.isArray(row?.art_sources) ? row.art_sources : [];
    const normalSources = allSources.filter((entry) => entry?.source === 'normal');
    const sources = normalSources.length ? normalSources : allSources;
    if (!sources.length) continue;

    for (const source of sources) {
      if (!source?.url) continue;

      let fps = cache.get(source.url);
      if (!fps) {
        try {
          const binary = await fetchBinary(source.url);
          if (!binary) continue;
          fps = computeFingerprintFromJpegBuffer(binary, jpeg, source.source || 'art_crop');
        } catch {
          fps = [];
        }
        cache.set(source.url, fps);
      }

      for (const fp of fps || []) {
        if (!fp) continue;
        const line = [
          sanitizeTsv(row.id),
          sanitizeTsv(row.set_code),
          sanitizeTsv(row.collector_number),
          sanitizeTsv(row.lang || 'en'),
          sanitizeTsv(`${row.art_variant || ''}|${source.source || 'art_crop'}|${fp.sourceVariant || ''}`),
          String(fp.phash_hi),
          String(fp.phash_lo),
          String(fp.dhash_hi),
          String(fp.dhash_lo),
          String(fp.bucket16),
          new Date().toISOString(),
        ].join('\t');

        if (!stream.write(`${line}\n`)) {
          await once(stream, 'drain');
        }
        count += 1;
      }
    }
    if (count > 0 && count % Math.max(1, progressEvery) === 0) {
      const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const rate = Math.round(count / elapsedSec);
      console.log(`[fingerprints] ${count} entries from ${maxRows} cards (${rate}/s)`);
    }
  }

  stream.end();
  await once(stream, 'finish');
  return count;
}

async function fetchDefaultCardsJsonPath(tempDir) {
  const bulkMetaResponse = await fetch('https://api.scryfall.com/bulk-data');
  if (!bulkMetaResponse.ok) {
    throw new Error(`Unable to fetch Scryfall bulk metadata (${bulkMetaResponse.status})`);
  }
  const bulkMeta = await bulkMetaResponse.json();
  const defaultCards = bulkMeta?.data?.find((entry) => entry.type === 'default_cards');
  if (!defaultCards?.download_uri) {
    throw new Error('Scryfall default_cards download uri missing');
  }

  const jsonResponse = await fetch(defaultCards.download_uri);
  if (!jsonResponse.ok) {
    throw new Error(`Unable to download default_cards (${jsonResponse.status})`);
  }
  const jsonText = await jsonResponse.text();
  const jsonPath = resolve(tempDir, 'default_cards.json');
  await writeFile(jsonPath, jsonText, 'utf8');
  return {
    jsonPath,
    sourceUpdatedAt: defaultCards.updated_at ?? null,
    sourceUri: defaultCards.download_uri,
  };
}

async function buildCatalog() {
  const { input, output, manifest, withFingerprints, fingerprintLimit, progressEvery } = parseArgs(process.argv);
  const tempDir = await mkdtemp(resolve(tmpdir(), 'bloodscroll-catalog-'));
  const cardsTsvPath = resolve(tempDir, 'catalog_cards.tsv');
  const aliasesTsvPath = resolve(tempDir, 'catalog_name_alias.tsv');
  const fingerprintsTsvPath = resolve(tempDir, 'catalog_card_fingerprint.tsv');

  try {
    let jsonPath = input ? resolve(process.cwd(), input) : '';
    let sourceUpdatedAt = null;
    let sourceUri = '';

    if (!jsonPath) {
      const downloaded = await fetchDefaultCardsJsonPath(tempDir);
      jsonPath = downloaded.jsonPath;
      sourceUpdatedAt = downloaded.sourceUpdatedAt;
      sourceUri = downloaded.sourceUri;
      console.log(`Downloaded Scryfall default_cards to ${jsonPath}`);
    }

    const raw = await readFile(jsonPath, 'utf8');
    const cards = JSON.parse(raw);
    if (!Array.isArray(cards)) {
      throw new Error('Input JSON must be an array of cards');
    }

    await mkdir(dirname(output), { recursive: true });
    await mkdir(dirname(manifest), { recursive: true });
    await rm(output, { force: true });

    const { cards: cardCount, aliases: aliasCount, englishRows } = await writeCatalogTsvs(
      cards,
      cardsTsvPath,
      aliasesTsvPath
    );
    let fingerprintsEnabled = withFingerprints;
    let jpeg = null;
    if (withFingerprints) {
      jpeg = await loadJpegModule(false);
      if (!jpeg) {
        fingerprintsEnabled = false;
        console.warn('jpeg-js non installato: fingerprint disabilitati per questa build catalogo.');
      }
    }
    const fingerprintCount = await writeFingerprintTsv(englishRows, fingerprintsTsvPath, {
      withFingerprints: fingerprintsEnabled,
      fingerprintLimit,
      jpeg,
      progressEvery,
    });

    runSqlite(
      output,
      `PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
CREATE TABLE catalog_cards (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT,
  set_code TEXT,
  collector_number TEXT,
  mana_cost TEXT,
  type_line TEXT,
  released_at TEXT
);
CREATE TABLE catalog_name_alias (
  alias_norm TEXT NOT NULL,
  card_id TEXT NOT NULL
);
CREATE TABLE catalog_card_fingerprint (
  card_id TEXT NOT NULL,
  set_code TEXT,
  collector_number TEXT,
  lang TEXT,
  art_variant TEXT,
  phash_hi INTEGER NOT NULL,
  phash_lo INTEGER NOT NULL,
  dhash_hi INTEGER NOT NULL,
  dhash_lo INTEGER NOT NULL,
  bucket16 INTEGER NOT NULL,
  updated_at TEXT
);
CREATE TABLE catalog_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);`
    );

    const escapedCardsTsvPath = cardsTsvPath.replace(/'/g, "''");
    const escapedAliasesTsvPath = aliasesTsvPath.replace(/'/g, "''");
    const escapedFingerprintsTsvPath = fingerprintsTsvPath.replace(/'/g, "''");
    runSqlite(
      output,
      `.mode tabs
.import '${escapedCardsTsvPath}' catalog_cards
.import '${escapedAliasesTsvPath}' catalog_name_alias
.import '${escapedFingerprintsTsvPath}' catalog_card_fingerprint
`
    );

    const catalogVersion = sourceUpdatedAt
      ? new Date(sourceUpdatedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    runSqlite(
      output,
      `CREATE INDEX idx_catalog_cards_name_norm ON catalog_cards(name_norm);
CREATE INDEX idx_catalog_cards_set_collector ON catalog_cards(set_code, collector_number);
CREATE INDEX idx_catalog_name_alias_norm ON catalog_name_alias(alias_norm);
CREATE INDEX idx_catalog_name_alias_card ON catalog_name_alias(card_id);
CREATE INDEX idx_fingerprint_bucket16 ON catalog_card_fingerprint(bucket16);
CREATE INDEX idx_fingerprint_set_collector ON catalog_card_fingerprint(set_code, collector_number);
CREATE INDEX idx_fingerprint_card_id ON catalog_card_fingerprint(card_id);
DELETE FROM catalog_cards WHERE name_norm IS NULL OR TRIM(name_norm) = '';
DELETE FROM catalog_name_alias WHERE alias_norm IS NULL OR TRIM(alias_norm) = '';
INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('catalog_version', '${catalogVersion}');
INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('catalog_source', 'bundled');
INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('catalog_updated_at', '${new Date().toISOString()}');
INSERT OR REPLACE INTO catalog_meta (key, value) VALUES ('catalog_published_at', '${sourceUpdatedAt || ''}');`
    );

    const dbBuffer = await readFile(output);
    const md5 = createHash('md5').update(dbBuffer).digest('hex');
    const manifestPayload = {
      version: catalogVersion,
      generatedAt: new Date().toISOString(),
      cards: cardCount,
      aliases: aliasCount,
      fingerprints: fingerprintCount,
      md5,
      source: sourceUri || jsonPath,
      dbUrl: 'REPLACE_ME_WITH_RELEASE_ASSET_URL',
    };
    await writeFile(manifest, JSON.stringify(manifestPayload, null, 2), 'utf8');

    console.log(`Catalog DB created: ${output}`);
    console.log(`Cards imported: ${cardCount}`);
    console.log(`Fingerprints imported: ${manifestPayload.fingerprints ?? 0}`);
    console.log(`Manifest template created: ${manifest}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

buildCatalog().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
