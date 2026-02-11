import { openDatabaseSync } from 'expo-sqlite';

const DB_NAME = 'bloodscroll.db';
const SCHEMA_VERSION = 2;

const db = openDatabaseSync(DB_NAME);

async function exec(sql, params = []) {
  return db.runAsync(sql, params);
}

async function queryAll(sql, params = []) {
  return db.getAllAsync(sql, params);
}

async function queryFirst(sql, params = []) {
  return db.getFirstAsync(sql, params);
}

function isPlaceholderDeckName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return true;
  return /^new deck(\s+\d+)?$/i.test(trimmed);
}

export async function initDb() {
  const versionRow = await queryFirst('PRAGMA user_version;');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    await exec(
      `CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        commander_card_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`
    );
    await exec(
      `CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        mana_cost TEXT,
        type_line TEXT,
        oracle_text TEXT,
        colors TEXT,
        color_identity TEXT,
        cmc REAL,
        legal_commander INTEGER,
        image_uri TEXT,
        art_image_uri TEXT,
        set_code TEXT,
        collector_number TEXT
      );`
    );
    await exec(
      `CREATE TABLE IF NOT EXISTS deck_cards (
        deck_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        is_commander INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, card_id)
      );`
    );
    await exec('CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);');
    await exec('PRAGMA user_version = 1;');
  }

  if (currentVersion < 2) {
    try {
      await exec('ALTER TABLE cards ADD COLUMN art_image_uri TEXT;');
    } catch {
      // Column already exists.
    }
    await exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
}

export async function listDecks() {
  return queryAll('SELECT * FROM decks ORDER BY updated_at DESC;');
}

export async function listDecksWithCommanderMeta() {
  return queryAll(
    `SELECT d.*,
            c.name AS commander_name,
            c.image_uri AS commander_image_uri,
            c.art_image_uri AS commander_art_image_uri,
            c.color_identity AS commander_color_identity
     FROM decks d
     LEFT JOIN cards c ON c.id = d.commander_card_id
     ORDER BY d.updated_at DESC;`
  );
}

export async function createDeck(name) {
  const id = `deck_${Date.now()}`;
  const now = new Date().toISOString();
  const finalName = (name ?? '').trim();
  await exec(
    'INSERT INTO decks (id, name, commander_card_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?);',
    [id, finalName, now, now]
  );
  return { id, name: finalName, commander_card_id: null, created_at: now, updated_at: now };
}

export async function getDeck(deckId) {
  const deck = await queryFirst('SELECT * FROM decks WHERE id = ?;', [deckId]);
  if (!deck) return null;
  const cards = await queryAll(
    `SELECT dc.deck_id, dc.card_id, dc.quantity, dc.is_commander, c.*
     FROM deck_cards dc
     JOIN cards c ON c.id = dc.card_id
     WHERE dc.deck_id = ?
     ORDER BY dc.is_commander DESC, c.name ASC;`,
    [deckId]
  );
  return { ...deck, cards: cards ?? [] };
}

export async function getCard(cardId) {
  const row = await queryFirst('SELECT * FROM cards WHERE id = ?;', [cardId]);
  return row || null;
}

export async function getDeckCardById(deckId, cardId) {
  return queryFirst(
    `SELECT dc.deck_id, dc.card_id, dc.quantity, dc.is_commander, c.*
     FROM deck_cards dc
     JOIN cards c ON c.id = dc.card_id
     WHERE dc.deck_id = ? AND dc.card_id = ?;`,
    [deckId, cardId]
  );
}

export async function upsertCard(card) {
  await exec(
    `INSERT OR REPLACE INTO cards
      (id, name, mana_cost, type_line, oracle_text, colors, color_identity, cmc, legal_commander, image_uri, art_image_uri, set_code, collector_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      card.id,
      card.name,
      card.mana_cost ?? null,
      card.type_line ?? null,
      card.oracle_text ?? null,
      card.colors ?? null,
      card.color_identity ?? null,
      card.cmc ?? null,
      card.legal_commander ?? 0,
      card.image_uri ?? null,
      card.art_image_uri ?? null,
      card.set_code ?? null,
      card.collector_number ?? null,
    ]
  );
}

export async function setCommander(deckId, card) {
  await upsertCard(card);
  const deck = await queryFirst('SELECT name FROM decks WHERE id = ?;', [deckId]);
  const shouldAutoname = isPlaceholderDeckName(deck?.name);
  const nextName = shouldAutoname ? card.name : deck?.name;
  await exec('UPDATE decks SET commander_card_id = ?, name = ?, updated_at = ? WHERE id = ?;', [
    card.id,
    nextName,
    new Date().toISOString(),
    deckId,
  ]);
  await exec(
    'INSERT OR REPLACE INTO deck_cards (deck_id, card_id, quantity, is_commander) VALUES (?, ?, ?, 1);',
    [deckId, card.id, 1]
  );
}

export async function renameDeck(deckId, name) {
  await exec('UPDATE decks SET name = ?, updated_at = ? WHERE id = ?;', [
    (name ?? '').trim(),
    new Date().toISOString(),
    deckId,
  ]);
}

export async function addCardToDeck(deckId, cardId, qty = 1) {
  const existing = await queryFirst(
    'SELECT quantity FROM deck_cards WHERE deck_id = ? AND card_id = ?;',
    [deckId, cardId]
  );
  if (existing) {
    const current = existing.quantity;
    await exec(
      'UPDATE deck_cards SET quantity = ? WHERE deck_id = ? AND card_id = ?;',
      [current + qty, deckId, cardId]
    );
  } else {
    await exec(
      'INSERT INTO deck_cards (deck_id, card_id, quantity, is_commander) VALUES (?, ?, ?, 0);',
      [deckId, cardId, qty]
    );
  }
  await exec('UPDATE decks SET updated_at = ? WHERE id = ?;', [
    new Date().toISOString(),
    deckId,
  ]);
}

export async function updateDeckCardQuantity(deckId, cardId, nextQty) {
  if (nextQty <= 0) {
    await exec('DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?;', [deckId, cardId]);
  } else {
    await exec(
      'UPDATE deck_cards SET quantity = ? WHERE deck_id = ? AND card_id = ?;',
      [nextQty, deckId, cardId]
    );
  }
  await exec('UPDATE decks SET updated_at = ? WHERE id = ?;', [
    new Date().toISOString(),
    deckId,
  ]);
}

export async function updateCardImageUri(cardId, imageUri) {
  await exec('UPDATE cards SET image_uri = ? WHERE id = ?;', [imageUri, cardId]);
}
