import type { Row } from "../rows";
import type { TableParse } from "../table";
import type { Finding, LineItem, SourcedText, Totals } from "../schema";

export type PageRead = {
  page: number;
  status: "read" | "refused";
  title: string | null;
  rows: Row[];
  table: TableParse | null;
  freeText: Row[];
};

// Every rule sees the same pre-rule snapshot, never another rule's results.
export type RuleContext = {
  pages: PageRead[];
  lineItems: LineItem[];
  totals: Totals;
  fields: SourcedText[];
  refusals: Finding[];
};

export type LineWarning = { lineItemId: string; warningId: string };

export type RuleResult = {
  refusals: Finding[];
  warnings: Finding[];
  refuseTotals?: Array<"subtotal" | "gst" | "total">;
  refuseAmounts?: string[];
  lineWarnings?: LineWarning[];
};

export type Rule = (ctx: RuleContext) => RuleResult;
