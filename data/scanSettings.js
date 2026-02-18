import { ensureCatalogReady, getCatalogMetaValue, setCatalogMetaValue } from './catalogDb';

const KEYS = {
  engine: 'scanner_engine',
  multilingualFallback: 'scanner_multilingual_fallback',
};

export const SCANNER_ENGINES = {
  LEGACY_OCR: 'legacy_ocr',
  HYBRID_HASH_BETA: 'hybrid_hash_beta',
};

const DEFAULT_SETTINGS = {
  engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
  multilingualFallback: false,
};

function normalizeEngine(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === SCANNER_ENGINES.HYBRID_HASH_BETA) return SCANNER_ENGINES.HYBRID_HASH_BETA;
  return SCANNER_ENGINES.LEGACY_OCR;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'off'].includes(lowered)) return false;
  }
  return fallback;
}

export async function getScanSettings() {
  await ensureCatalogReady();
  const [engineRaw, multilingualRaw] = await Promise.all([
    getCatalogMetaValue(KEYS.engine),
    getCatalogMetaValue(KEYS.multilingualFallback),
  ]);

  return {
    engine: normalizeEngine(engineRaw || DEFAULT_SETTINGS.engine),
    multilingualFallback: normalizeBoolean(multilingualRaw, DEFAULT_SETTINGS.multilingualFallback),
  };
}

export async function setScannerEngine(engine) {
  await ensureCatalogReady();
  const normalized = normalizeEngine(engine);
  await setCatalogMetaValue(KEYS.engine, normalized);
  return normalized;
}

export async function setMultilingualFallback(enabled) {
  await ensureCatalogReady();
  const normalized = normalizeBoolean(enabled, false);
  await setCatalogMetaValue(KEYS.multilingualFallback, normalized ? '1' : '0');
  return normalized;
}
