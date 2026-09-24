import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadSample(name: string): Uint8Array<ArrayBuffer> {
  const buffer = readFileSync(join(process.cwd(), "public", "samples", name));
  // Plain Uint8Array so sample tests don't lean on loadPdf's Buffer handling
  return new Uint8Array(buffer);
}
