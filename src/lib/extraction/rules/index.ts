import type { Rule } from "./types";
import { arithmetic } from "./arithmetic";

// Refusal rules register here; extract.ts applies whatever this list contains.
export const rules: Rule[] = [arithmetic];
