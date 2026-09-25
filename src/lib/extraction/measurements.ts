import type { Finding, LineItem } from "./schema";
import { basisFromWords, parseMeasurement, refusalReason } from "./values";

export function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function lineName(item: LineItem): string {
  return item.code ?? item.description;
}

export function unitWord(item: LineItem): string {
  const stated = item.unit ?? item.unitPrice?.per;
  return !stated || /^(ea|each|pcs?|no|units?)$/i.test(stated) ? "item" : stated;
}

function ambiguousReason(item: LineItem, label: string, raw: string, totalsElsewhere: number): string {
  const qty = item.quantity?.raw;
  const choice = qty ? `for each ${unitWord(item)} or for all ${qty}` : "per item or for the whole line";
  const others = totalsElsewhere === 1 ? "Another line in this column says" : "Other lines in this column say";
  const hint = totalsElsewhere > 0 ? ` ${others} "total", so we can't assume the same here.` : "";
  return `The ${label.toLowerCase()} "${raw}" doesn't say whether it's ${choice}, so we didn't use it.${hint}`;
}

// A non-core column becomes a measurement column once any of its cells reads as a number with a unit.
export function readMeasurements(items: LineItem[], labels: string[], page: number): { findings: Finding[]; measureLabels: string[] } {
  const findings: Finding[] = [];
  const measureLabels: string[] = [];

  for (const label of labels) {
    const cells = items.flatMap((item) => {
      const cell = item.otherColumns.find((c) => c.label === label);
      return cell ? [{ item, cell, parsed: parseMeasurement(cell.raw) }] : [];
    });
    if (!cells.some((c) => c.parsed.ok)) continue;
    measureLabels.push(label);

    const headerBasis = basisFromWords(label);
    const totalsElsewhere = cells.filter((c) => c.parsed.ok && c.parsed.value.basis === "line").length;

    for (const { item, cell, parsed } of cells) {
      const id = `measure:${item.id}:${slug(label)}`;
      const base = { id, scope: "field" as const, page, lineItemId: item.id, evidence: [cell.evidence], calculation: null };
      const subject = `${label} for ${lineName(item)}`;

      if (!parsed.ok) {
        findings.push({ ...base, code: "VALUE_UNPARSEABLE", subject, reason: refusalReason(label.toLowerCase(), cell.raw, parsed.why) });
        continue;
      }
      const basis = parsed.value.basis ?? headerBasis;
      if (!basis) {
        findings.push({ ...base, code: "AMBIGUOUS", subject, reason: ambiguousReason(item, label, cell.raw, totalsElsewhere) });
        continue;
      }
      item.measurements.push({
        label,
        value: parsed.value.value,
        unit: parsed.value.unit,
        basis,
        raw: cell.raw,
        evidence: cell.evidence,
      });
    }
  }

  return { findings, measureLabels };
}
