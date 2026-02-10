import * as SQLite from 'expo-sqlite';

const DB_NAME = 'bloodscroll.db';
const SCHEMA_VERSION = 1;

const db = SQLite.openDatabase(DB_NAME);

function exec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result),
        (_, error) => {
          reject(error);
          return false;
        }
      );
    });
  });
}

export async function initDb() {
  const versionResult = await exec('PRAGMA user_version;');
  const currentVersion = versionResult.rows.item(0)?.user_version ?? 0;

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
    await exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
}

export async function listDecks() {
  const result = await exec('SELECT * FROM decks ORDER BY updated_at DESC;');
  return result.rows._array ?? [];
}

export async function createDeck(name) {
  const id = `deck_${Date.now()}`;
  const now = new Date().toISOString();
  await exec(
    'INSERT INTO decks (id, name, commander_card_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?);',
    [id, name, now, now]
  );
  return { id, name, commander_card_id: null, created_at: now, updated_at: now };
}

export async function getDeck(deckId) {
  const deckResult = await exec('SELECT * FROM decks WHERE id = ?;', [deckId]);
  const deck = deckResult.rows.item(0);
  if (!deck) return null;
  const cardsResult = await exec(
    `SELECT dc.deck_id, dc.card_id, dc.quantity, dc.is_commander, c.*
     FROM deck_cards dc
     JOIN cards c ON c.id = dc.card_id
     WHERE dc.deck_id = ?;`,
    [deckId]
  );
  return { ...deck, cards: cardsResult.rows._array ?? [] };
}

export async function getCard(cardId) {
  const result = await exec('SELECT * FROM cards WHERE id = ?;', [cardId]);
  return result.rows.item(0) || null;
}

export async function upsertCard(card) {
  await exec(
    `INSERT OR REPLACE INTO cards
      (id, name, mana_cost, type_line, oracle_text, colors, color_identity, cmc, legal_commander, image_uri, set_code, collector_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      card.set_code ?? null,
      card.collector_number ?? null,
    ]
  );
}

export async function setCommander(deckId, card) {
  await upsertCard(card);
  await exec('UPDATE decks SET commander_card_id = ?, updated_at = ? WHERE id = ?;', [
    card.id,
    new Date().toISOString(),
    deckId,
  ]);
  await exec(
    'INSERT OR REPLACE INTO deck_cards (deck_id, card_id, quantity, is_commander) VALUES (?, ?, ?, 1);',
    [deckId, card.id, 1]
  );
}

export async function addCardToDeck(deckId, cardId, qty = 1) {
  const existing = await exec(
    'SELECT quantity FROM deck_cards WHERE deck_id = ? AND card_id = ?;',
    [deckId, cardId]
  );
  if (existing.rows.length) {
    const current = existing.rows.item(0).quantity;
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
