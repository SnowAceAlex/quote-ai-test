import type { Evidence, Finding } from "../schema";
import type { Row } from "../rows";

type FindingInput = Omit<Finding, "page" | "lineItemId" | "calculation" | "scope"> &
  Partial<Pick<Finding, "page" | "lineItemId" | "calculation" | "scope">>;

export function finding(input: FindingInput): Finding {
  return { scope: "document", page: null, lineItemId: null, calculation: null, ...input };
}

export function rowEvidence(row: Row, page: number): Evidence {
  return { page, sourceText: row.text };
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}
