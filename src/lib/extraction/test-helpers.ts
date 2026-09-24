import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadSample(name: string): Uint8Array {
  const buffer = readFileSync(join(process.cwd(), "public", "samples", name));
  // pdf.js rejects a Node Buffer outright even though it's a Uint8Array subclass
  return new Uint8Array(buffer);
}
