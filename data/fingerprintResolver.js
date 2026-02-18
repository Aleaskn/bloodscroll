import { searchFingerprintCandidatesByBucket } from './catalogDb';
import { resolveByFingerprintWithRepository } from './fingerprintResolverCore.mjs';

export { resolveByFingerprintWithRepository };

export async function resolveByFingerprint({
  phash_hi,
  phash_lo,
  dhash_hi,
  dhash_lo,
  bucket16,
  setCode,
  collectorNumber,
  editionText,
}) {
  return resolveByFingerprintWithRepository(
    { searchFingerprintCandidatesByBucket },
    {
      phash_hi,
      phash_lo,
      dhash_hi,
      dhash_lo,
      bucket16,
      setCode,
      collectorNumber,
      editionText,
    }
  );
}
