import type { Rule } from "./types";
import { arithmetic } from "./arithmetic";
import { contradictions } from "./contradictions";
import { completeness } from "./completeness";

// Refusal rules register here; extract.ts applies whatever this list contains.
export const rules: Rule[] = [arithmetic, contradictions, completeness];
