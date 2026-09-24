import { formatCents } from "../values";
import type { Finding, LineItem } from "../schema";
import type { TotalKind } from "../document";
import type { Rule, RuleContext } from "./types";
import { finding, toCents } from "./finding";

const DISCOUNT = /disc|less|rebate|%/i;

function lineLabel(item: LineItem): string {
  return item.code ?? item.description;
}

function checkLine(item: LineItem): Finding | null {
  const { quantity, unitPrice, amount } = item;
  if (!quantity || !unitPrice || !amount) return null;
  // "$74.00 /carton" against a qty in some other unit isn't ours to multiply.
  if (unitPrice.per && item.unit && unitPrice.per !== item.unit) return null;

  const expected = Math.round(quantity.value * toCents(unitPrice.value));
  if (expected === toCents(amount.value)) return null;

  const calculation = `${quantity.raw} × ${unitPrice.raw} = ${formatCents(expected)}`;
  return finding({
    id: `arith:${item.id}:amount`,
    code: "DOES_NOT_ADD_UP",
    scope: "line",
    page: item.page,
    lineItemId: item.id,
    subject: `Amount for ${lineLabel(item)}`,
    reason: `${quantity.raw} × ${unitPrice.raw} comes to ${formatCents(expected)}, but the line says ${amount.raw}. We can't tell which figure is wrong, so we didn't use the amount.`,
    evidence: [item.evidence],
    calculation,
  });
}

// Only sum lines when nothing on any page was lost, otherwise the sum means nothing.
function linesAreComplete(ctx: RuleContext, badAmounts: Set<string>): boolean {
  const lostSomething = ctx.refusals.some(
    (r) => r.code === "NO_TEXT_LAYER" || r.code === "PAGE_UNREADABLE" || r.code === "NO_TABLE_FOUND" || r.scope === "line" || (r.scope === "field" && r.lineItemId),
  );
  return (
    !lostSomething &&
    ctx.lineItems.length > 0 &&
    ctx.lineItems.every((i) => i.amount && !badAmounts.has(i.id))
  );
}

export const arithmetic: Rule = (ctx) => {
  const refusals: Finding[] = [];
  const refuseTotals: TotalKind[] = [];
  const refuseAmounts: string[] = [];

  // A discount column means qty × price legitimately differs from the amount.
  const discounted = new Set(
    ctx.pages.filter((p) => p.table?.columns.some((c) => c.role === "other" && DISCOUNT.test(c.label))).map((p) => p.page),
  );
  for (const item of ctx.lineItems) {
    const bad = discounted.has(item.page) ? null : checkLine(item);
    if (bad) {
      refusals.push(bad);
      refuseAmounts.push(item.id);
    }
  }

  const { subtotal, gst, total } = ctx.totals;
  const complete = linesAreComplete(ctx, new Set(refuseAmounts));
  const lineSum = ctx.lineItems.reduce((sum, i) => sum + (i.amount ? toCents(i.amount.value) : 0), 0);

  if (subtotal && complete && lineSum !== toCents(subtotal.value)) {
    refuseTotals.push("subtotal");
    refusals.push(
      finding({
        id: "arith:subtotal",
        code: "DOES_NOT_ADD_UP",
        subject: "Subtotal",
        reason: `The line amounts add up to ${formatCents(lineSum)}, but the subtotal says ${subtotal.raw}, so we didn't use the subtotal.`,
        evidence: [subtotal.evidence],
        calculation: `sum of line amounts = ${formatCents(lineSum)}`,
      }),
    );
  }

  if (subtotal && gst && gst.ratePercent !== null) {
    const expected = Math.round((toCents(subtotal.value) * gst.ratePercent) / 100);
    if (expected !== toCents(gst.value)) {
      refuseTotals.push("gst");
      refusals.push(
        finding({
          id: "arith:gst",
          code: "DOES_NOT_ADD_UP",
          subject: "GST",
          reason: `${gst.ratePercent}% of the subtotal ${subtotal.raw} is ${formatCents(expected)}, but the GST line says ${gst.raw}, so we didn't use the GST figure.`,
          evidence: [subtotal.evidence, gst.evidence],
          calculation: `${subtotal.raw} × ${gst.ratePercent}% = ${formatCents(expected)}`,
        }),
      );
    }
  }

  if (total) {
    let expected: number | null = null;
    let calculation = "";
    const evidence = [total.evidence];
    if (subtotal && gst && total.includesGst !== false) {
      expected = toCents(subtotal.value) + toCents(gst.value);
      calculation = `${subtotal.raw} + ${gst.raw} = ${formatCents(expected)}`;
      evidence.unshift(subtotal.evidence, gst.evidence);
    } else if (!subtotal && !gst && complete) {
      expected = lineSum;
      calculation = `sum of line amounts = ${formatCents(expected)}`;
    }
    if (expected !== null && expected !== toCents(total.value)) {
      refuseTotals.push("total");
      refusals.push(
        finding({
          id: "arith:total",
          code: "DOES_NOT_ADD_UP",
          subject: total.includesGst ? "Total (incl GST)" : "Total",
          reason: `${calculation}, but the document states the total as ${total.raw}. We can't tell which figure is wrong, so we didn't use the total.`,
          evidence,
          calculation,
        }),
      );
    }
  }

  return { refusals, warnings: [], refuseTotals, refuseAmounts };
};
