import { findBySetCollector, searchByNameNormalized } from './catalogDb';
import {
  buildNameCandidatesFromOcrText,
  buildSetCollectorCandidates,
  resolveLocalScannedCardWithRepository,
} from './catalogResolverCore.mjs';

export { buildNameCandidatesFromOcrText, buildSetCollectorCandidates };

export async function resolveLocalScannedCard(input) {
  return resolveLocalScannedCardWithRepository(
    {
      findBySetCollector,
      searchByNameNormalized,
    },
    input
  );
}
