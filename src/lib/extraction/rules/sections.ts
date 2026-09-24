import type { Finding } from "../schema";
import type { LineWarning, Rule } from "./types";
import { finding } from "./finding";

const SERIES = /invoice (\d+) of (\d+)/i;

export const sections: Rule = (ctx) => {
  const numbered = ctx.pages.flatMap((p) => {
    const m = p.title?.match(SERIES);
    return m ? [{ page: p.page, n: Number(m[1]), of: Number(m[2]) }] : [];
  });
  if (numbered.length === 0) return { refusals: [], warnings: [] };

  const of = Math.max(...numbered.map((s) => s.of));
  const found = new Set(numbered.map((s) => s.n));
  const unreadable = ctx.pages.filter((p) => p.status === "refused").map((p) => p.page);
  const warnings: Finding[] = [];
  const lineWarnings: LineWarning[] = [];

  for (let n = 1; n <= of; n++) {
    if (found.has(n)) continue;
    const hint = unreadable.length
      ? ` Page ${unreadable.join(", ")} couldn't be read, so it's probably there.`
      : "";
    warnings.push(
      finding({
        id: `section:invoice-${n}`,
        code: "MISSING_SECTION",
        subject: `Invoice ${n} of ${of}`,
        reason: `We couldn't find invoice ${n} of ${of} in the readable text, so its lines aren't included.${hint}`,
        evidence: [],
      }),
    );
  }

  for (const page of ctx.pages) {
    if (page.status !== "read" || !page.title || SERIES.test(page.title)) continue;
    const id = `section:p${page.page}`;
    warnings.push(
      finding({
        id,
        code: "NOT_AN_INVOICE_PAGE",
        scope: "page",
        page: page.page,
        subject: `Page ${page.page}`,
        reason: `Page ${page.page} is titled "${page.title}", which isn't one of the numbered invoices (1–${of}). Its lines are listed, but they may repeat or cancel out invoice lines, so check them before adding anything up.`,
        evidence: [{ page: page.page, sourceText: page.title }],
      }),
    );
    for (const item of ctx.lineItems.filter((i) => i.page === page.page)) {
      lineWarnings.push({ lineItemId: item.id, warningId: id });
    }
  }

  return { refusals: [], warnings, lineWarnings };
};
