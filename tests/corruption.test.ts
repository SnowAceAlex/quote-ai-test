import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractDocument } from "@/lib/extraction/extract";
import { PdfLoadError } from "@/lib/extraction/pdf";
import { loadSample } from "@/lib/extraction/test-helpers";
import { assertTraceable } from "./support/assert-traceable";

const SAMPLES = ["IB-55871", "IB-55902", "IB-56010", "IB-56088", "IB-56150", "IB-STMT47"];
const RUNS_PER_SAMPLE = 15;

// Seeded so a failure can be replayed exactly.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutate(original: Uint8Array, rand: () => number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(original);
  if (rand() < 0.3) return bytes.slice(0, 16 + Math.floor(rand() * (bytes.length - 16)));
  const flips = 1 + Math.floor(rand() * 20);
  for (let i = 0; i < flips; i++) {
    // Leave the %PDF- header alone so the loader actually tries.
    bytes[16 + Math.floor(rand() * (bytes.length - 16))] = Math.floor(rand() * 256);
  }
  return bytes;
}

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe("damaged files never produce untraceable numbers or unexpected crashes", () => {
  it.each(SAMPLES)("%s", async (name) => {
    const original = loadSample(`${name}.pdf`);
    const rand = random(name.length * 7919);
    for (let run = 0; run < RUNS_PER_SAMPLE; run++) {
      const bytes = mutate(original, rand);
      let result;
      try {
        result = await extractDocument(bytes, `${name}-mutant-${run}.pdf`);
      } catch (error) {
        expect(error, `run ${run}`).toBeInstanceOf(PdfLoadError);
        continue;
      }
      await assertTraceable(result, bytes);
    }
  }, 60_000);
});
