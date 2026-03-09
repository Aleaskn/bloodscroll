import { ensureCatalogReady, getCatalogMetaValue, setCatalogMetaValue } from './catalogDb';

const KEYS = {
  engine: 'scanner_engine',
};

export const SCANNER_ENGINES = {
  HYBRID_HASH_BETA: 'hybrid_hash_beta',
};

const DEFAULT_SETTINGS = {
  engine: SCANNER_ENGINES.HYBRID_HASH_BETA,
};

function normalizeEngine(value) {
  if (String(value ?? '').trim().toLowerCase() === SCANNER_ENGINES.HYBRID_HASH_BETA) {
    return SCANNER_ENGINES.HYBRID_HASH_BETA;
  }
  return SCANNER_ENGINES.HYBRID_HASH_BETA;
}

export async function getScanSettings() {
  await ensureCatalogReady();
  const engineRaw = await getCatalogMetaValue(KEYS.engine);

  return {
    engine: normalizeEngine(engineRaw || DEFAULT_SETTINGS.engine),
  };
}

export async function setScannerEngine(engine) {
  await ensureCatalogReady();
  const normalized = normalizeEngine(engine);
  await setCatalogMetaValue(KEYS.engine, normalized);
  return normalized;
}
