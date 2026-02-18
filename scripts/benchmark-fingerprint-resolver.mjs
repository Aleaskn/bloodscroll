#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { splitHex64ToHiLo } from '../data/fingerprintCore.mjs';
import { resolveByFingerprintWithRepository } from '../data/fingerprintResolverCore.mjs';

function mustSplit(hex) {
  const value = splitHex64ToHiLo(hex);
  if (!value) throw new Error(`invalid hex ${hex}`);
  return value;
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

async function main() {
  const iterations = Math.max(1, Number(process.argv[2] ?? 1000));
  const p = mustSplit('0f0f0f0f0f0f0f0f');
  const d = mustSplit('f0f0f0f0f0f0f0f0');
  const bucket16 = (p.hi >>> 16) & 0xffff;

  const repository = {
    async searchFingerprintCandidatesByBucket() {
      const rows = [];
      for (let i = 0; i < 70; i += 1) {
        rows.push({
          card_id: `cand-${i}`,
          name: `Candidate ${i}`,
          set_code: 'set',
          collector_number: String(i + 1),
          phash_hi: p.hi ^ randomInt(7),
          phash_lo: p.lo ^ randomInt(7),
          dhash_hi: d.hi ^ randomInt(7),
          dhash_lo: d.lo ^ randomInt(7),
        });
      }
      rows.push({
        card_id: 'target',
        name: 'Target Card',
        set_code: 'blc',
        collector_number: '96',
        phash_hi: p.hi,
        phash_lo: p.lo,
        dhash_hi: d.hi,
        dhash_lo: d.lo,
      });
      return rows;
    },
  };

  const started = performance.now();
  let matched = 0;

  for (let i = 0; i < iterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await resolveByFingerprintWithRepository(repository, {
      phash_hi: p.hi,
      phash_lo: p.lo,
      dhash_hi: d.hi,
      dhash_lo: d.lo,
      bucket16,
      editionText: 'M 0096 BLC EN',
    });
    if (result.status === 'matched') matched += 1;
  }

  const elapsedMs = performance.now() - started;
  const avgMs = elapsedMs / iterations;

  console.log(`Iterations: ${iterations}`);
  console.log(`Matched: ${matched}`);
  console.log(`Total ms: ${elapsedMs.toFixed(2)}`);
  console.log(`Avg ms/query: ${avgMs.toFixed(3)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
