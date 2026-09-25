import { expect } from "vitest";
import { loadPdf } from "@/lib/extraction/pdf";
import { buildRows } from "@/lib/extraction/rows";
import type { Evidence, ExtractionResult } from "@/lib/extraction/schema";

// The core promise: every value we output is printed verbatim on the page it names.
export async function assertTraceable(result: ExtractionResult, bytes: Uint8Array): Promise<void> {
  const pdf = await loadPdf(bytes);
  const texts = new Map<number, Set<string>>();
  for (let n = 1; n <= pdf.pageCount; n++) {
    try {
      texts.set(n, new Set(buildRows((await pdf.getPage(n)).items).map((row) => row.text)));
    } catch {
      texts.set(n, new Set());
    }
  }
  const onPage = (e: Evidence) => expect(texts.get(e.page)?.has(e.sourceText), `page ${e.page}: ${e.sourceText}`).toBe(true);

  const sourced = [
    ...result.fields,
    ...result.lineItems.flatMap((i) => [i.quantity, i.unitPrice, i.amount, ...i.otherColumns, ...i.measurements]),
    result.totals.subtotal,
    result.totals.gst,
    result.totals.total,
  ].filter((v) => v !== null);

  for (const v of sourced) {
    expect(v.evidence.sourceText).toContain(v.raw);
    onPage(v.evidence);
  }
  for (const item of result.lineItems) onPage(item.evidence);
  for (const f of [...result.refusals, ...result.warnings]) f.evidence.forEach(onPage);

  const ids = [...result.refusals, ...result.warnings].map((f) => f.id);
  expect(new Set(ids).size).toBe(ids.length);
}
