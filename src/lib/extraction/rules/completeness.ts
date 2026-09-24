import type { Evidence, Finding } from "../schema";
import type { Rule, RuleContext } from "./types";
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
        reason: `This document has no Amount column${tail}. We haven't multiplied quantities by prices ourselves; they're listed as written.`,
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
        reason: "This line has no amount, so we haven't worked one out.",
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
    ? `This is labelled a tax invoice but doesn't show GST separately, so we can't tell whether the total of ${total.raw} includes GST.`
    : "This is labelled a tax invoice but doesn't show a GST amount, so we haven't reported one.";
  return [finding({ id: "missing:gst", code: "NOT_STATED", subject: "GST", reason, evidence: [label] })];
}

function ambiguousWeights(ctx: RuleContext): Finding[] {
  const weights = ctx.lineItems.flatMap((i) => i.otherColumns.filter((c) => /weight/i.test(c.label)));
  if (weights.length === 0) return [];
  const units = new Set(weights.map((w) => w.raw.match(/[a-z]+/i)?.[0].toLowerCase()));
  const someTotal = weights.some((w) => /total/i.test(w.raw));
  const allTotal = weights.every((w) => /total/i.test(w.raw));
  if (units.size <= 1 && (allTotal || !someTotal)) return [];

  const notes = ctx.pages.flatMap((p) =>
    p.freeText.filter((r) => /weight/i.test(r.text)).map((r) => rowEvidence(r, p.page)),
  );
  return [
    finding({
      id: "ambiguous:weight",
      code: "AMBIGUOUS",
      subject: "Total weight",
      reason:
        "Weights are written in different units and only some say they're for the whole line, so we can't tell whether each figure is per item or per line. We've shown them as written and haven't added them up.",
      evidence: notes.length > 0 ? notes : weights.map((w) => w.evidence),
    }),
  ];
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
      reason: "No page of this document states a total, so we haven't reported one. We don't add up line items ourselves.",
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
          reason: `The document shows "${r.text}", but we don't recognise "${label}" as a subtotal, GST or total, so we haven't used that figure.`,
          evidence: [rowEvidence(r, p.page)],
        });
      }),
  );
}

export const completeness: Rule = (ctx) => ({
  refusals: [
    ...missingAmounts(ctx),
    ...missingGst(ctx),
    ...ambiguousWeights(ctx),
    ...missingDocumentTotal(ctx),
    ...unrecognisedFigures(ctx),
  ],
  warnings: [],
});
