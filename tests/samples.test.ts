import { beforeAll, describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/extraction/extract";
import { loadPdf } from "@/lib/extraction/pdf";
import { buildRows } from "@/lib/extraction/rows";
import { loadSample } from "@/lib/extraction/test-helpers";
import type { Evidence, ExtractionResult } from "@/lib/extraction/schema";

const SAMPLES = ["IB-55871", "IB-55902", "IB-56010", "IB-56088", "IB-56150", "IB-STMT47"] as const;
type Sample = (typeof SAMPLES)[number];

const results = {} as Record<Sample, ExtractionResult>;

beforeAll(async () => {
  for (const name of SAMPLES) {
    results[name] = await extractDocument(loadSample(`${name}.pdf`), `${name}.pdf`);
  }
});

const refusalIds = (r: ExtractionResult) => r.refusals.map((f) => f.id).sort();

describe("sample documents", () => {
  it("IB-55871 (clean) extracts everything and refuses nothing", () => {
    const r = results["IB-55871"];
    expect(r.outcome).toBe("complete");
    expect(r.lineItems).toHaveLength(4);
    expect(r.refusals).toEqual([]);
    expect(r.totals.total?.raw).toBe("$3,747.85");
  });

  it("IB-55902 (scanned) refuses the page instead of failing", () => {
    const r = results["IB-55902"];
    expect(r.outcome).toBe("nothing_extracted");
    expect(refusalIds(r)).toEqual(["page:1:no-text"]);
  });

  it("IB-56010 never works out amounts, GST or a total weight it wasn't given", () => {
    const r = results["IB-56010"];
    expect(r.lineItems).toHaveLength(4);
    expect(r.lineItems.every((i) => i.amount === null)).toBe(true);
    expect(r.totals).toEqual({ subtotal: null, gst: null, total: null });
    expect(refusalIds(r)).toEqual(["ambiguous:weight", "missing:amounts", "missing:gst"]);
  });

  it("IB-56088 refuses the carton count, quoting both statements", () => {
    const r = results["IB-56088"];
    const cartons = r.refusals.find((f) => f.id === "count:carton");
    expect(cartons?.code).toBe("CONTRADICTION");
    expect(cartons?.evidence.map((e) => e.sourceText)).toEqual([
      "Summary: 9 cartons dispatched from Ironbark warehouse this run.",
      "Warehouse notes: 11 cartons picked and loaded onto the truck.",
    ]);
    expect(r.totals.total?.raw).toBe("$2,050.00");
    expect(r.totals.total?.includesGst).toBeNull();
    expect(refusalIds(r)).toContain("missing:gst");
  });

  it("IB-56150 refuses the total that doesn't add up and keeps the rest", () => {
    const r = results["IB-56150"];
    expect(r.totals.total).toBeNull();
    expect(r.totals.subtotal?.raw).toBe("$1,270.00");
    expect(r.totals.gst?.raw).toBe("$190.50");
    const total = r.refusals.find((f) => f.id === "arith:total");
    expect(total?.calculation).toBe("$1,270.00 + $190.50 = $1,460.50");
    expect(total?.reason).toContain("$1,501.80");
    expect(total?.evidence).toHaveLength(3);
  });

  it("IB-STMT47 contains the scanned page and flags the non-invoice pages", () => {
    const r = results["IB-STMT47"];
    expect(r.lineItems).toHaveLength(21);
    expect(r.pages.filter((p) => p.status === "refused").map((p) => p.page)).toEqual([4]);
    expect(refusalIds(r)).toEqual(["missing:total", "page:4:no-text"]);
    expect(r.warnings.map((w) => w.id)).toEqual([
      "section:invoice-4",
      "section:p5",
      "section:p6",
      "section:p7",
      "section:p8",
    ]);
    expect(r.lineItems.filter((i) => i.warningIds.length > 0)).toHaveLength(12);
  });
});

describe("every value points at its source", () => {
  async function pageTexts(name: Sample): Promise<Map<number, Set<string>>> {
    const pdf = await loadPdf(loadSample(`${name}.pdf`));
    const texts = new Map<number, Set<string>>();
    for (let n = 1; n <= pdf.pageCount; n++) {
      const page = await pdf.getPage(n);
      texts.set(n, new Set(buildRows(page.items).map((row) => row.text)));
    }
    return texts;
  }

  it.each(SAMPLES)("%s", async (name) => {
    const r = results[name];
    const texts = await pageTexts(name);
    const onPage = (e: Evidence) => expect(texts.get(e.page)?.has(e.sourceText), e.sourceText).toBe(true);

    const sourced = [
      ...r.fields,
      ...r.lineItems.flatMap((i) => [i.quantity, i.unitPrice, i.amount, ...i.otherColumns]),
      r.totals.subtotal,
      r.totals.gst,
      r.totals.total,
    ].filter((v) => v !== null);

    for (const v of sourced) {
      expect(v.evidence.sourceText).toContain(v.raw);
      onPage(v.evidence);
    }
    for (const f of [...r.refusals, ...r.warnings]) f.evidence.forEach(onPage);
  });
});
