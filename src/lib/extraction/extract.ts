import { loadPdf, type LoadedPage } from "./pdf";
import { buildRows } from "./rows";
import { parseTable } from "./table";
import { readTitle, readFields, readTotals, freeTextRows, type TotalKind } from "./document";
import { rules } from "./rules/index";
import type { PageRead, Rule, RuleContext } from "./rules/types";
import {
  ExtractionResult,
  type Evidence,
  type Finding,
  type LineItem,
  type PageSummary,
  type SourcedMoney,
  type SourcedText,
  type Totals,
} from "./schema";

type PdfSource = { getPage(n: number): Promise<LoadedPage> };

type PageReadResult = {
  pageRead: PageRead;
  refusals: Finding[];
  fields: SourcedText[];
  totals: Totals;
};

function pageFinding(id: string, code: Finding["code"], page: number, reason: string): Finding {
  return {
    id,
    code,
    scope: "page",
    page,
    lineItemId: null,
    subject: `Page ${page}`,
    reason,
    evidence: [],
    calculation: null,
  };
}

// Per-page reader: never throws - a page's own errors become a refusal instead.
export async function readPage(pdf: PdfSource, n: number, multiPage: boolean): Promise<PageReadResult> {
  const suffix = multiPage ? " The other pages were read normally." : "";
  const emptyPageRead: PageRead = { page: n, status: "refused", title: null, rows: [], table: null, freeText: [] };
  const emptyTotals: Totals = { subtotal: null, gst: null, total: null };

  try {
    const loaded = await pdf.getPage(n);

    if (loaded.items.length === 0) {
      const reason = loaded.imageCount > 0
        ? `Page ${n} is a scanned image with no readable text, so nothing on it was extracted.${suffix}`
        : `Page ${n} has no readable text, so nothing on it was extracted.${suffix}`;
      return {
        pageRead: emptyPageRead,
        refusals: [pageFinding(`page:${n}:no-text`, "NO_TEXT_LAYER", n, reason)],
        fields: [],
        totals: emptyTotals,
      };
    }

    const rows = buildRows(loaded.items);
    const table = parseTable(rows, n);
    const above = rows.slice(0, table?.headerIndex ?? rows.length);
    const below = rows.slice(table?.endIndex ?? rows.length);

    const title = readTitle(above);
    const fields = readFields(above, n);
    const totals = readTotals(below, n);
    const freeText = freeTextRows(rows, table);

    const refusals = table
      ? [...table.rowFindings]
      : [
          pageFinding(
            `page:${n}:no-table`,
            "NO_TABLE_FOUND",
            n,
            `We couldn't find a line-item table on page ${n} (we look for a header row with Description and Qty columns), so no line items were taken from it.`,
          ),
        ];

    return {
      pageRead: { page: n, status: "read", title, rows, table, freeText },
      refusals,
      fields,
      totals,
    };
  } catch {
    // Don't leak the underlying exception's message into a user-facing reason.
    const reason = `Something in page ${n}'s content stopped us from reading it, so nothing on it was extracted.${suffix}`;
    return {
      pageRead: emptyPageRead,
      refusals: [pageFinding(`page:${n}:unreadable`, "PAGE_UNREADABLE", n, reason)],
      fields: [],
      totals: emptyTotals,
    };
  }
}

function dedupeFields(fields: SourcedText[]): SourcedText[] {
  const seen = new Set<string>();
  const result: SourcedText[] = [];
  for (const field of fields) {
    const key = `${field.label}\u0000${field.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(field);
  }
  return result;
}

const TOTAL_SUBJECT: Record<TotalKind, string> = { subtotal: "Subtotal", gst: "GST", total: "Total" };

function englishList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function conflictFinding(kind: TotalKind, values: Array<{ raw: string; evidence: Evidence }>): Finding {
  const subject = TOTAL_SUBJECT[kind];
  const parts = values.map((v) => `${v.raw} on page ${v.evidence.page}`);
  return {
    id: `totals:${kind}:conflict`,
    code: "CONTRADICTION",
    scope: "document",
    page: null,
    lineItemId: null,
    subject,
    reason: `${subject} is stated as ${englishList(parts)}, so we can't tell which is right.`,
    evidence: values.map((v) => v.evidence),
    calculation: null,
  };
}

// First-page-wins when every page agrees; otherwise refuse rather than guess which value is right.
function resolveKind<T extends { raw: string; evidence: Evidence }>(
  kind: TotalKind,
  values: T[],
): { value: T | null; refusal: Finding | null } {
  if (values.length === 0) return { value: null, refusal: null };
  if (new Set(values.map((v) => v.raw)).size === 1) return { value: values[0], refusal: null };
  return { value: null, refusal: conflictFinding(kind, values) };
}

// The totals merger: combines each page's Totals into one, refusing (never guessing) on conflict.
export function mergeTotals(perPage: Array<{ page: number; totals: Totals }>): { totals: Totals; refusals: Finding[] } {
  const subtotals = perPage.map((p) => p.totals.subtotal).filter((v): v is SourcedMoney => v !== null);
  const gsts = perPage.map((p) => p.totals.gst).filter((v): v is NonNullable<Totals["gst"]> => v !== null);
  const totalsList = perPage.map((p) => p.totals.total).filter((v): v is NonNullable<Totals["total"]> => v !== null);

  const subtotalResult = resolveKind("subtotal", subtotals);
  const gstResult = resolveKind("gst", gsts);
  const totalResult = resolveKind("total", totalsList);

  const refusals = [subtotalResult.refusal, gstResult.refusal, totalResult.refusal].filter(
    (f): f is Finding => f !== null,
  );

  return {
    totals: { subtotal: subtotalResult.value, gst: gstResult.value, total: totalResult.value },
    refusals,
  };
}

// A rule that throws is not caught here - a rule crash must surface, not look like a clean pass.
function applyRules(
  ruleList: Rule[],
  ctx: RuleContext,
): { lineItems: LineItem[]; totals: Totals; refusals: Finding[]; warnings: Finding[] } {
  let lineItems = ctx.lineItems;
  let totals = ctx.totals;
  const refusals: Finding[] = [];
  const warnings: Finding[] = [];

  for (const rule of ruleList) {
    const result = rule(ctx);
    refusals.push(...result.refusals);
    warnings.push(...result.warnings);

    if (result.refuseTotals?.length) {
      const next = { ...totals };
      for (const kind of result.refuseTotals) next[kind] = null;
      totals = next;
    }

    const refuseAmounts = new Set(result.refuseAmounts ?? []);
    const warningsByItem = new Map<string, string[]>();
    for (const w of result.lineWarnings ?? []) {
      warningsByItem.set(w.lineItemId, [...(warningsByItem.get(w.lineItemId) ?? []), w.warningId]);
    }

    if (refuseAmounts.size > 0 || warningsByItem.size > 0) {
      lineItems = lineItems.map((item) => {
        const extraWarnings = warningsByItem.get(item.id);
        if (!refuseAmounts.has(item.id) && !extraWarnings) return item;
        return {
          ...item,
          amount: refuseAmounts.has(item.id) ? null : item.amount,
          warningIds: extraWarnings ? [...item.warningIds, ...extraWarnings] : item.warningIds,
        };
      });
    }
  }

  return { lineItems, totals, refusals, warnings };
}

export async function extractDocument(
  bytes: Uint8Array,
  fileName: string,
  ruleList: Rule[] = rules,
): Promise<ExtractionResult> {
  const pdf = await loadPdf(bytes);
  const multiPage = pdf.pageCount > 1;

  const pages: PageSummary[] = [];
  const pageReads: PageRead[] = [];
  const lineItems: LineItem[] = [];
  const allFields: SourcedText[] = [];
  const perPageTotals: Array<{ page: number; totals: Totals }> = [];
  const refusals: Finding[] = [];

  for (let n = 1; n <= pdf.pageCount; n++) {
    const { pageRead, refusals: pageRefusals, fields, totals } = await readPage(pdf, n, multiPage);

    pageReads.push(pageRead);
    pages.push({
      page: n,
      status: pageRead.status,
      title: pageRead.title,
      lineItemCount: pageRead.table?.lineItems.length ?? 0,
    });
    if (pageRead.table) lineItems.push(...pageRead.table.lineItems);
    allFields.push(...fields);
    perPageTotals.push({ page: n, totals });
    refusals.push(...pageRefusals);
  }

  const fields = dedupeFields(allFields);
  const { totals: mergedTotals, refusals: totalsRefusals } = mergeTotals(perPageTotals);
  refusals.push(...totalsRefusals);

  const ctx: RuleContext = { pages: pageReads, lineItems, totals: mergedTotals, fields };
  const applied = applyRules(ruleList, ctx);
  refusals.push(...applied.refusals);

  const outcome: ExtractionResult["outcome"] =
    applied.lineItems.length === 0 ? "nothing_extracted" : refusals.length === 0 ? "complete" : "partial";

  const result: ExtractionResult = {
    fileName,
    pageCount: pdf.pageCount,
    outcome,
    pages,
    fields,
    lineItems: applied.lineItems,
    totals: applied.totals,
    refusals,
    warnings: applied.warnings,
  };

  return ExtractionResult.parse(result);
}
