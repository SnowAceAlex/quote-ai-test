import type { Row } from "./rows";
import type { TableParse } from "./table";
import { parseMoney, parsePercent } from "./values";
import type { Evidence, SourcedMoney, SourcedText, Totals } from "./schema";

const FIELD_ROW = /^([^:]{1,40}):\s+(.+)$/;
const TOTALS_ROW = /^(.+?):\s*(\S+)$/;

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
    const parsed = parseFieldRow(rows[i]);
    if (!parsed) continue;
    fields.push({ ...parsed, evidence: { page, sourceText: rows[i].text } });
  }
  return fields;
}

type TotalKind = "subtotal" | "gst" | "total";

function totalKindForLabel(label: string): TotalKind | null {
  // "Total (incl GST)" both starts with "Total" and contains "GST" - the prefix wins so it
  // doesn't get mistaken for the separate GST line.
  if (label.startsWith("Subtotal")) return "subtotal";
  if (label.startsWith("Total")) return "total";
  if (label.includes("GST")) return "gst";
  return null;
}

function includesGstFromLabel(label: string): boolean | null {
  const lower = label.toLowerCase();
  if (lower.includes("incl gst")) return true;
  if (lower.includes("excl gst")) return false;
  return null;
}

export type TotalsRowMatch = { kind: TotalKind; label: string; raw: string; cents: number; per: string | null };

export function isTotalsRow(row: Row): TotalsRowMatch | null {
  const match = TOTALS_ROW.exec(row.text);
  if (!match) return null;
  const [, labelRaw, raw] = match;
  const label = labelRaw.trim();
  const kind = totalKindForLabel(label);
  if (!kind) return null;
  const parsed = parseMoney(raw);
  if (!parsed.ok) return null;
  return { kind, label, raw, cents: parsed.value.cents, per: parsed.value.per };
}

export function readTotals(rows: Row[], page: number): Totals {
  const totals: Totals = { subtotal: null, gst: null, total: null };
  for (const row of rows) {
    const found = isTotalsRow(row);
    if (!found) continue;
    const evidence: Evidence = { page, sourceText: row.text };
    const money: SourcedMoney = { value: found.cents / 100, raw: found.raw, per: found.per, evidence };

    if (found.kind === "subtotal" && !totals.subtotal) totals.subtotal = money;
    if (found.kind === "gst" && !totals.gst) totals.gst = { ...money, ratePercent: parsePercent(found.label) };
    if (found.kind === "total" && !totals.total) totals.total = { ...money, includesGst: includesGstFromLabel(found.label) };
  }
  return totals;
}

export function freeTextRows(rows: Row[], table: TableParse | null): Row[] {
  const start = table?.headerIndex ?? rows.length;
  const end = table?.endIndex ?? rows.length;
  return rows.filter((row, i) => {
    if (i < 2) return false;
    if (i >= start && i < end) return false;
    return !isTotalsRow(row);
  });
}
