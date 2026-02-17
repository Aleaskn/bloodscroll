#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const DEFAULT_OUTPUT_DB = resolve(process.cwd(), 'assets/catalog/cards-catalog.db');
const DEFAULT_OUTPUT_MANIFEST = resolve(process.cwd(), 'assets/catalog/catalog-manifest.local.json');

function parseArgs(argv) {
  const args = {
    input: '',
    output: DEFAULT_OUTPUT_DB,
    manifest: DEFAULT_OUTPUT_MANIFEST,
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
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTsv(value) {
  return String(value ?? '')
    .replace(/\t/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
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

async function writeCardsTsv(cards, tsvPath) {
  const stream = createWriteStream(tsvPath, { encoding: 'utf8' });
  let count = 0;

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

    if (!stream.write(`${line}\n`)) {
      // eslint-disable-next-line no-await-in-loop
      await once(stream, 'drain');
    }
    count += 1;
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
  const { input, output, manifest } = parseArgs(process.argv);
  const tempDir = await mkdtemp(resolve(tmpdir(), 'bloodscroll-catalog-'));
  const tsvPath = resolve(tempDir, 'catalog_cards.tsv');

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

    const cardCount = await writeCardsTsv(cards, tsvPath);

    runSqlite(
      output,
      `PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
CREATE TABLE catalog_cards (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  set_code TEXT,
  collector_number TEXT,
  mana_cost TEXT,
  type_line TEXT,
  released_at TEXT
);
CREATE TABLE catalog_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);`
    );

    const escapedTsvPath = tsvPath.replace(/'/g, "''");
    runSqlite(
      output,
      `.mode tabs
.import '${escapedTsvPath}' catalog_cards
`
    );

    const catalogVersion = sourceUpdatedAt
      ? new Date(sourceUpdatedAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    runSqlite(
      output,
      `CREATE INDEX idx_catalog_cards_name_norm ON catalog_cards(name_norm);
CREATE INDEX idx_catalog_cards_set_collector ON catalog_cards(set_code, collector_number);
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
      md5,
      source: sourceUri || jsonPath,
      dbUrl: 'REPLACE_ME_WITH_RELEASE_ASSET_URL',
    };
    await writeFile(manifest, JSON.stringify(manifestPayload, null, 2), 'utf8');

    console.log(`Catalog DB created: ${output}`);
    console.log(`Cards imported: ${cardCount}`);
    console.log(`Manifest template created: ${manifest}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

buildCatalog().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

