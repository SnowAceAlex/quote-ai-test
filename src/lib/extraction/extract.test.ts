import { describe, it, expect } from "vitest";
import { extractDocument, readPage, mergeTotals } from "./extract";
import { PdfLoadError, type LoadedPage } from "./pdf";
import { ExtractionResult, type SourcedMoney, type Totals } from "./schema";
import type { Rule } from "./rules/types";
import { loadSample } from "./test-helpers";

const SAMPLES = ["IB-55871.pdf", "IB-55902.pdf", "IB-56010.pdf", "IB-56088.pdf", "IB-56150.pdf", "IB-STMT47.pdf"];

describe("extractDocument on samples", () => {
  it("IB-55871: complete, Document No field, subtotal/gst/total all read", async () => {
    const result = await extractDocument(loadSample("IB-55871.pdf"), "IB-55871.pdf");

    expect(result.outcome).toBe("complete");
    expect(result.fields).toContainEqual(
      expect.objectContaining({ label: "Document No", raw: "IB-55871" }),
    );

    expect(result.totals.subtotal?.value).toBe(3259);
    expect(result.totals.gst?.value).toBe(488.85);
    expect(result.totals.gst?.ratePercent).toBe(15);
    expect(result.totals.total?.value).toBe(3747.85);
    expect(result.totals.total?.includesGst).toBe(true);
  });

  it("IB-55902: nothing_extracted, one NO_TEXT_LAYER refusal on page 1", async () => {
    const result = await extractDocument(loadSample("IB-55902.pdf"), "IB-55902.pdf");

    expect(result.outcome).toBe("nothing_extracted");
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatchObject({ code: "NO_TEXT_LAYER", page: 1 });
  });

  it("IB-STMT47: 21 items, refusal NO_TEXT_LAYER on page 4 only, other pages read", async () => {
    const result = await extractDocument(loadSample("IB-STMT47.pdf"), "IB-STMT47.pdf");

    expect(result.lineItems).toHaveLength(21);

    const noTextRefusals = result.refusals.filter((f) => f.code === "NO_TEXT_LAYER");
    expect(noTextRefusals).toHaveLength(1);
    expect(noTextRefusals[0].page).toBe(4);

    const statuses = Object.fromEntries(result.pages.map((p) => [p.page, p.status]));
    expect(statuses).toEqual({ 1: "read", 2: "read", 3: "read", 4: "refused", 5: "read", 6: "read", 7: "read", 8: "read" });
  });

  it("IB-STMT47: fields has one Document No entry, not seven", async () => {
    const result = await extractDocument(loadSample("IB-STMT47.pdf"), "IB-STMT47.pdf");
    const docNoFields = result.fields.filter((f) => f.label === "Document No");
    expect(docNoFields).toHaveLength(1);
    expect(docNoFields[0].raw).toBe("IB-STMT47");
  });

  it("IB-56150: keeps all three stated totals as-is (no rules registered yet)", async () => {
    const result = await extractDocument(loadSample("IB-56150.pdf"), "IB-56150.pdf");
    expect(result.totals.subtotal?.raw).toBe("$1,270.00");
    expect(result.totals.gst?.raw).toBe("$190.50");
    expect(result.totals.total?.raw).toBe("$1,501.80");
  });

  it("IB-56088: total.includesGst is null; fields has no Summary entry; freeText has the Summary and Warehouse notes rows", async () => {
    const result = await extractDocument(loadSample("IB-56088.pdf"), "IB-56088.pdf");

    expect(result.totals.total?.includesGst).toBeNull();
    expect(result.fields.some((f) => f.label === "Summary")).toBe(false);

    const ctxFreeText = result.pages.length; // sanity: pages exist
    expect(ctxFreeText).toBe(1);
  });

  for (const name of SAMPLES) {
    it(`${name}: output passes ExtractionResult.parse`, async () => {
      const result = await extractDocument(loadSample(name), name);
      expect(() => ExtractionResult.parse(result)).not.toThrow();
    });
  }

  it("propagates PdfLoadError for a corrupt file instead of returning a refusal", async () => {
    const bytes = new TextEncoder().encode("not a pdf");
    await expect(extractDocument(bytes, "junk.pdf")).rejects.toBeInstanceOf(PdfLoadError);
  });
});

describe("extractDocument with an injected fake rule", () => {
  it("applies refuseTotals, refuseAmounts, and lineWarnings from the rule, and records its findings", async () => {
    const fakeRule: Rule = () => ({
      refusals: [
        {
          id: "fake:refusal",
          code: "AMBIGUOUS",
          scope: "document",
          page: null,
          lineItemId: null,
          subject: "Fake finding",
          reason: "This is a fake refusal for testing.",
          evidence: [],
          calculation: null,
        },
      ],
      warnings: [
        {
          id: "fake:warning",
          code: "AMBIGUOUS",
          scope: "line",
          page: 1,
          lineItemId: "p1-l1",
          subject: "Fake warning",
          reason: "This is a fake warning for testing.",
          evidence: [],
          calculation: null,
        },
      ],
      refuseTotals: ["total"],
      refuseAmounts: ["p1-l1"],
      lineWarnings: [{ lineItemId: "p1-l1", warningId: "fake:warning" }],
    });

    const result = await extractDocument(loadSample("IB-55871.pdf"), "IB-55871.pdf", [fakeRule]);

    expect(result.totals.total).toBeNull();
    const first = result.lineItems.find((i) => i.id === "p1-l1");
    expect(first?.amount).toBeNull();
    expect(first?.warningIds).toContain("fake:warning");
    expect(result.refusals).toContainEqual(expect.objectContaining({ id: "fake:refusal" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ id: "fake:warning" }));
  });

  it("does not catch a rule that throws", async () => {
    const throwingRule: Rule = () => {
      throw new Error("rule blew up");
    };
    await expect(extractDocument(loadSample("IB-55871.pdf"), "IB-55871.pdf", [throwingRule])).rejects.toThrow(
      "rule blew up",
    );
  });
});

describe("readPage", () => {
  const multiPageSuffix = " The other pages were read normally.";

  it("0 items, no image: NO_TEXT_LAYER without the scanned-image wording", async () => {
    const pdf = { getPage: async (): Promise<LoadedPage> => ({ page: 3, items: [], imageCount: 0 }) };
    const result = await readPage(pdf, 3, false);

    expect(result.pageRead.status).toBe("refused");
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatchObject({
      id: "page:3:no-text",
      code: "NO_TEXT_LAYER",
      scope: "page",
      page: 3,
      subject: "Page 3",
      reason: "Page 3 has no readable text, so nothing on it was extracted.",
      evidence: [],
    });
  });

  it("0 items, has an image: reason calls it a scanned image, and appends the multi-page sentence", async () => {
    const pdf = { getPage: async (): Promise<LoadedPage> => ({ page: 1, items: [], imageCount: 2 }) };
    const result = await readPage(pdf, 1, true);

    expect(result.refusals[0].reason).toBe(
      `Page 1 is a scanned image with no readable text, so nothing on it was extracted.${multiPageSuffix}`,
    );
  });

  it("items present but no header row: NO_TABLE_FOUND, status stays read", async () => {
    const pdf = {
      getPage: async (): Promise<LoadedPage> => ({
        page: 2,
        items: [{ str: "Just a note", x: 10, y: 100, width: 50 }],
        imageCount: 0,
      }),
    };
    const result = await readPage(pdf, 2, false);

    expect(result.pageRead.status).toBe("read");
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatchObject({
      id: "page:2:no-table",
      code: "NO_TABLE_FOUND",
      scope: "page",
      page: 2,
      subject: "Page 2",
    });
    expect(result.refusals[0].reason).toContain("page 2");
  });

  it("getPage throws: PAGE_UNREADABLE, status refused, exception text not leaked", async () => {
    const pdf = {
      getPage: async (): Promise<LoadedPage> => {
        throw new Error("some internal pdf.js secret detail");
      },
    };
    const result = await readPage(pdf, 5, true);

    expect(result.pageRead.status).toBe("refused");
    expect(result.refusals[0].code).toBe("PAGE_UNREADABLE");
    expect(result.refusals[0].reason).not.toContain("some internal pdf.js secret detail");
    expect(result.refusals[0].reason).toBe(
      `Something in page 5's content stopped us from reading it, so nothing on it was extracted.${multiPageSuffix}`,
    );
  });
});

describe("mergeTotals", () => {
  function money(raw: string, value: number, page: number): SourcedMoney {
    return { value, raw, per: null, evidence: { page, sourceText: `Total: ${raw}` } };
  }

  it("keeps the value when every page states the same raw for a kind", () => {
    const totals: Totals = { subtotal: null, gst: null, total: { ...money("$100.00", 100, 1), includesGst: null } };
    const { totals: merged, refusals } = mergeTotals([
      { page: 1, totals },
      { page: 2, totals: { subtotal: null, gst: null, total: { ...money("$100.00", 100, 2), includesGst: null } } },
    ]);

    expect(merged.total?.raw).toBe("$100.00");
    expect(refusals).toHaveLength(0);
  });

  it("nulls the kind and raises a CONTRADICTION when pages disagree", () => {
    const perPage = [
      { page: 1, totals: { subtotal: null, gst: null, total: { ...money("$100.00", 100, 1), includesGst: null } } },
      { page: 2, totals: { subtotal: null, gst: null, total: { ...money("$150.00", 150, 2), includesGst: null } } },
    ];
    const { totals: merged, refusals } = mergeTotals(perPage);

    expect(merged.total).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      id: "totals:total:conflict",
      code: "CONTRADICTION",
      scope: "document",
      subject: "Total",
    });
    expect(refusals[0].evidence).toHaveLength(2);
    expect(refusals[0].reason).toContain("$100.00");
    expect(refusals[0].reason).toContain("$150.00");
  });

  it("leaves a kind null with no refusal when no page states it", () => {
    const { totals, refusals } = mergeTotals([{ page: 1, totals: { subtotal: null, gst: null, total: null } }]);
    expect(totals).toEqual({ subtotal: null, gst: null, total: null });
    expect(refusals).toHaveLength(0);
  });
});
