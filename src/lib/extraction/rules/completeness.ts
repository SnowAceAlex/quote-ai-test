import type { Evidence, Finding } from "../schema";
import type { Rule, RuleContext } from "./types";
import { slug } from "../measurements";
import { parseMeasurement } from "../values";
import { finding, rowEvidence } from "./finding";

function tablesLackAmounts(ctx: RuleContext): boolean {
  const tables = ctx.pages.flatMap((p) => (p.table ? [p.table] : []));
  return tables.length > 0 && tables.every((t) => !t.columns.some((c) => c.role === "amount"));
}

function missingAmounts(ctx: RuleContext): Finding[] {
  if (tablesLackAmounts(ctx)) {
    const tail = ctx.totals.total ? "" : " and no total";
    return [
      finding({
        id: "missing:amounts",
        code: "NOT_STATED",
        subject: ctx.totals.total ? "Line amounts" : "Line amounts and total",
        reason: `This document has no Amount column${tail}.`,
        evidence: [],
      }),
    ];
  }
  // A blank cell under a real Amount column; unreadable ones already have their own refusal.
  const already = new Set(ctx.refusals.map((r) => r.id));
  return ctx.lineItems
    .filter((i) => !i.amount && !already.has(`value:${i.id}:amount`))
    .filter((i) => ctx.pages.find((p) => p.page === i.page)?.table?.columns.some((c) => c.role === "amount"))
    .map((i) =>
      finding({
        id: `missing:${i.id}:amount`,
        code: "NOT_STATED",
        scope: "line",
        page: i.page,
        lineItemId: i.id,
        subject: `Amount for ${i.code ?? i.description}`,
        reason: "This line has no amount, so I haven't worked one out.",
        evidence: [i.evidence],
      }),
    );
}

function taxInvoiceEvidence(ctx: RuleContext): Evidence | null {
  for (const page of ctx.pages) {
    const row = page.rows.find((r) => /tax invoice/i.test(r.text));
    if (row) return rowEvidence(row, page.page);
  }
  return null;
}

function missingGst(ctx: RuleContext): Finding[] {
  const { gst, total } = ctx.totals;
  if (gst || ctx.refusals.some((r) => r.id.startsWith("totals:gst"))) return [];
  const label = taxInvoiceEvidence(ctx);
  if (!label) return [];
  const reason = total
    ? `This is labelled a tax invoice but doesn't show GST separately, so I can't tell whether the total of ${total.raw} includes GST.`
    : "This is labelled a tax invoice but doesn't show a GST amount, so I haven't reported one.";
  return [finding({ id: "missing:gst", code: "NOT_STATED", subject: "GST", reason, evidence: [label] })];
}

function listInWords(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// Adding up a measurement column is only safe when every line was read, on one basis, in one unit.
function unsafeMeasurementTotals(ctx: RuleContext): Finding[] {
  const labels = [...new Set(ctx.pages.flatMap((p) => p.table?.measureLabels ?? []))];
  return labels.flatMap((label) => {
    const cells = ctx.lineItems.flatMap((i) => i.otherColumns.filter((c) => c.label === label));
    const read = ctx.lineItems.flatMap((i) => i.measurements.filter((m) => m.label === label));
    const units = new Set(cells.flatMap((c) => {
      const parsed = parseMeasurement(c.raw);
      return parsed.ok ? [parsed.value.unit] : [];
    }));
    const bases = new Set(read.map((m) => m.basis));

    const problems: string[] = [];
    const unclear = cells.length - read.length;
    if (unclear > 0) problems.push(`${unclear} of ${cells.length} lines don't say clearly what their figure covers`);
    if (bases.size > 1) problems.push("some figures are for the whole line and some for each unit");
    if (units.size > 1) problems.push(`the figures are in different units (${listInWords([...units])})`);
    if (problems.length === 0) return [];

    const word = label.toLowerCase();
    const notes = ctx.pages.flatMap((p) =>
      p.freeText.filter((r) => r.text.toLowerCase().includes(word)).map((r) => rowEvidence(r, p.page)),
    );
    return [
      finding({
        id: `ambiguous:total:${slug(label)}`,
        code: "AMBIGUOUS",
        subject: `Total ${word}`,
        reason: `We haven't added up the ${word} because ${listInWords(problems)}. Each line's ${word} is shown as written.`,
        evidence: notes.length > 0 ? notes : cells.map((c) => c.evidence),
      }),
    ];
  });
}

function missingDocumentTotal(ctx: RuleContext): Finding[] {
  const { subtotal, gst, total } = ctx.totals;
  const totalsRefused = ctx.refusals.some((r) => r.id.startsWith("totals:"));
  if (ctx.pages.length < 2 || subtotal || gst || total || totalsRefused || tablesLackAmounts(ctx)) return [];
  return [
    finding({
      id: "missing:total",
      code: "NOT_STATED",
      subject: "Document total",
      reason: "No page of this document states a total, so I haven't reported one. I don't add up line items myself.",
      evidence: [],
    }),
  ];
}

const LABELLED_MONEY = /^([A-Za-z][\w ()%.-]*):\s*(\$\S+)$/;

// Totals only recognise a fixed vocabulary; anything else with a price on it must not vanish.
function unrecognisedFigures(ctx: RuleContext): Finding[] {
  return ctx.pages.flatMap((p) =>
    p.freeText
      .filter((r) => LABELLED_MONEY.test(r.text))
      .map((r, i) => {
        const label = r.text.match(LABELLED_MONEY)![1];
        return finding({
          id: `unrecognised:p${p.page}:${i + 1}`,
          code: "AMBIGUOUS",
          scope: "field",
          page: p.page,
          subject: label,
          reason: `The document shows "${r.text}", but I don't recognise "${label}" as a subtotal, GST or total, so I haven't used that figure.`,
          evidence: [rowEvidence(r, p.page)],
        });
      }),
  );
}

export const completeness: Rule = (ctx) => ({
  refusals: [
    ...missingAmounts(ctx),
    ...missingGst(ctx),
    ...unsafeMeasurementTotals(ctx),
    ...missingDocumentTotal(ctx),
    ...unrecognisedFigures(ctx),
  ],
  warnings: [],
});
