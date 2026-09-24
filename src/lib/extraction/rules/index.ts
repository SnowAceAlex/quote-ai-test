import type { Rule } from "./types";
import { arithmetic } from "./arithmetic";
import { contradictions } from "./contradictions";

// Refusal rules register here; extract.ts applies whatever this list contains.
export const rules: Rule[] = [arithmetic, contradictions];
