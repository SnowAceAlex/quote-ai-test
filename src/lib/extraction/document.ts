import type { Row } from "./rows";
import type { TableParse } from "./table";
import { parseMoney, parsePercent } from "./values";
import type { Evidence, Finding, SourcedMoney, SourcedText, Totals } from "./schema";

const FIELD_ROW = /^([^:]{1,40}):\s+(.+)$/;
const LABELLED_ROW = /^([^:]+):\s*(.*)$/;

export function readTitle(rows: Row[]): string | null {
  return rows[1]?.text ?? null;
}

function parseFieldRow(row: Row): { label: string; raw: string } | null {
  const match = FIELD_ROW.exec(row.text);
  if (!match) return null;
  const [, labelRaw, raw] = match;
  const label = labelRaw.trim();
  if (label.split(/\s+/).length > 3) return null;
  if (raw.endsWith(".")) return null;
  return { label, raw };
}

export function readFields(rows: Row[], page: number): SourcedText[] {
  const fields: SourcedText[] = [];
  for (let i = 2; i < rows.length; i++) {
    if (matchTotalsRow(rows[i])) continue;
    const parsed = parseFieldRow(rows[i]);
    if (!parsed) continue;
    fields.push({ ...parsed, evidence: { page, sourceText: rows[i].text } });
  }
  return fields;
}

export type TotalKind = "subtotal" | "gst" | "total";

const TOTAL_KINDS: TotalKind[] = ["subtotal", "gst", "total"];

const TOTAL_LABELS: Record<TotalKind, RegExp[]> = {
  // A total before GST is the subtotal; its own label stays visible in the evidence.
  subtotal: [/^sub-?total$/i, /^total \(?excl\.? gst\)?$/i],
  gst: [/^gst( \(\d+(\.\d+)?%\))?$/i, /^gst \d+(\.\d+)?%$/i],
  total: [/^(grand )?total( \(?incl\.? gst\)?)?$/i, /^total (due|payable)$/i],
};

const INCL_GST = /incl\.? gst/i;

const TOTAL_SUBJECT: Record<TotalKind, string> = { subtotal: "Subtotal", gst: "GST", total: "Total" };
const TOTAL_NOUN: Record<TotalKind, string> = { subtotal: "subtotal", gst: "GST amount", total: "total" };

export type TotalsRowMatch = { kind: TotalKind; label: string; raw: string };

export function matchTotalsRow(row: Row): TotalsRowMatch | null {
  const match = LABELLED_ROW.exec(row.text);
  if (!match) return null;
  const label = match[1].trim().replace(/\s+/g, " ");
  const kind = TOTAL_KINDS.find((k) => TOTAL_LABELS[k].some((pattern) => pattern.test(label)));
  if (!kind) return null;
  return { kind, label, raw: match[2].trim() };
}

export type StatedTotals = {
  subtotal: SourcedMoney[];
  gst: NonNullable<Totals["gst"]>[];
  total: NonNullable<Totals["total"]>[];
};

function unparseableTotalFinding(id: string, found: TotalsRowMatch, why: string, evidence: Evidence): Finding {
  return {
    id,
    code: "VALUE_UNPARSEABLE",
    scope: "field",
    page: evidence.page,
    lineItemId: null,
    subject: TOTAL_SUBJECT[found.kind],
    reason: `The ${TOTAL_NOUN[found.kind]} "${found.raw}" ${why}, so we didn't use it.`,
    evidence: [evidence],
    calculation: null,
  };
}

export function readTotals(rows: Row[], page: number): { stated: StatedTotals; refusals: Finding[] } {
  const stated: StatedTotals = { subtotal: [], gst: [], total: [] };
  const refusals: Finding[] = [];
  const unparseableCount: Record<TotalKind, number> = { subtotal: 0, gst: 0, total: 0 };

  for (const row of rows) {
    const found = matchTotalsRow(row);
    if (!found) continue;
    const evidence: Evidence = { page, sourceText: row.text };

    const parsed = parseMoney(found.raw);
    // Without a $ the figure could be a count or a reference number rather than money.
    if (!parsed.ok || !found.raw.includes("$")) {
      const why = parsed.ok ? "has no dollar sign to show it's money" : parsed.why;
      const n = ++unparseableCount[found.kind];
      const id = `totals:${found.kind}:p${page}:unparseable${n > 1 ? `:${n}` : ""}`;
      refusals.push(unparseableTotalFinding(id, found, why, evidence));
      continue;
    }

    const money: SourcedMoney = { value: parsed.value.cents / 100, raw: found.raw, per: parsed.value.per, evidence };
    if (found.kind === "subtotal") stated.subtotal.push(money);
    if (found.kind === "gst") stated.gst.push({ ...money, ratePercent: parsePercent(found.label) });
    if (found.kind === "total") stated.total.push({ ...money, includesGst: INCL_GST.test(found.label) ? true : null });
  }

  return { stated, refusals };
}

function englishList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function conflictFinding(kind: TotalKind, page: number, values: Array<{ raw: string; evidence: Evidence }>): Finding {
  const subject = TOTAL_SUBJECT[kind];
  const raws = [...new Set(values.map((v) => v.raw))];
  return {
    id: `totals:${kind}:conflict`,
    code: "CONTRADICTION",
    scope: "document",
    page,
    lineItemId: null,
    subject,
    reason: `${subject} is stated as ${englishList(raws)} on page ${page}, so we can't tell which is right.`,
    evidence: values.map((v) => v.evidence),
    calculation: null,
  };
}

function perPageFinding(kind: TotalKind, pages: number[], values: Array<{ raw: string; evidence: Evidence }>): Finding {
  const noun = TOTAL_NOUN[kind];
  return {
    id: `totals:${kind}:per-page`,
    code: "AMBIGUOUS",
    scope: "document",
    page: null,
    lineItemId: null,
    subject: TOTAL_SUBJECT[kind],
    reason:
      `Pages ${englishList(pages.map(String))} each state a ${noun} (${values.map((v) => v.raw).join(", ")}). ` +
      `They may be totals for separate invoices, so we haven't reported one ${noun} for the whole document.`,
    evidence: values.map((v) => v.evidence),
    calculation: null,
  };
}

// Figures on different pages may belong to different invoices, so even matching ones aren't merged.
function resolveKind<T extends { raw: string; evidence: Evidence }>(
  kind: TotalKind,
  values: T[],
): { value: T | null; refusal: Finding | null } {
  if (values.length === 0) return { value: null, refusal: null };
  const pages = [...new Set(values.map((v) => v.evidence.page))];
  if (pages.length > 1) return { value: null, refusal: perPageFinding(kind, pages, values) };
  if (new Set(values.map((v) => v.raw)).size === 1) return { value: values[0], refusal: null };
  return { value: null, refusal: conflictFinding(kind, pages[0], values) };
}

export function mergeTotals(perPage: StatedTotals[]): { totals: Totals; refusals: Finding[] } {
  const subtotal = resolveKind("subtotal", perPage.flatMap((p) => p.subtotal));
  const gst = resolveKind("gst", perPage.flatMap((p) => p.gst));
  const total = resolveKind("total", perPage.flatMap((p) => p.total));

  return {
    totals: { subtotal: subtotal.value, gst: gst.value, total: total.value },
    refusals: [subtotal.refusal, gst.refusal, total.refusal].filter((f): f is Finding => f !== null),
  };
}

export function freeTextRows(rows: Row[], table: TableParse | null): Row[] {
  const start = table?.headerIndex ?? rows.length;
  const end = table?.endIndex ?? rows.length;
  return rows.filter((row, i) => {
    if (i < 2) return false;
    if (i >= start && i < end) return false;
    return !matchTotalsRow(row);
  });
}
