import { describe, it, expect } from "vitest";
import { extractDocument, readPage } from "./extract";
import { PdfLoadError, type LoadedPage, type TextItem, loadPdf } from "./pdf";
import { ExtractionResult } from "./schema";
import type { Rule } from "./rules/types";
import { loadSample } from "./test-helpers";
import { buildRows } from "./rows";
import { parseTable } from "./table";
import { freeTextRows } from "./document";

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
    expect(result.refusals).toEqual([]);
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

    const pdf = await loadPdf(loadSample("IB-56088.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);
    const table = parseTable(rows, 1);
    const freeText = freeTextRows(rows, table);

    const freeTextStrings = freeText.map((r) => r.text);
    expect(freeTextStrings).toContainEqual("Summary: 9 cartons dispatched from Ironbark warehouse this run.");
    expect(freeTextStrings).toContainEqual("Warehouse notes: 11 cartons picked and loaded onto the truck.");
  });

  for (const name of SAMPLES) {
    it(`${name}: output passes ExtractionResult.parse`, async () => {
      const result = await extractDocument(loadSample(name), name);
      expect(() => ExtractionResult.parse(result)).not.toThrow();
    });

    it(`${name}: no row is refused as unreadable or stranded`, async () => {
      const result = await extractDocument(loadSample(name), name);
      expect(result.refusals.filter((f) => f.code === "ROW_UNPARSEABLE")).toEqual([]);
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

  it("outcome is still complete when rule returns only warnings and no refusals", async () => {
    const warningRule: Rule = () => ({
      refusals: [],
      warnings: [
        {
          id: "test:warning-only",
          code: "AMBIGUOUS",
          scope: "document",
          page: null,
          lineItemId: null,
          subject: "Test warning",
          reason: "This is a test warning with no refusals.",
          evidence: [],
          calculation: null,
        },
      ],
      refuseTotals: [],
      refuseAmounts: [],
      lineWarnings: [],
    });

    const result = await extractDocument(loadSample("IB-55871.pdf"), "IB-55871.pdf", [warningRule]);

    expect(result.outcome).toBe("complete");
    expect(result.warnings).toContainEqual(expect.objectContaining({ id: "test:warning-only" }));
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

  function item(str: string, x: number, y: number): TextItem {
    return { str, x, y, width: 10 };
  }

  function pageOf(items: TextItem[]) {
    return { getPage: async (): Promise<LoadedPage> => ({ page: 1, items, imageCount: 0 }) };
  }

  const HEADER = [
    item("Code", 42.52, 666),
    item("Description", 93.54, 666),
    item("Qty", 325.98, 666),
    item("Unit", 377.01, 666),
    item("Unit Price", 428.03, 666),
    item("Amount", 501.73, 666),
  ];

  function dataRow(code: string, description: string, qty: string, unitPrice: string, amount: string, y: number): TextItem[] {
    return [
      item(code, 42.52, y),
      item(description, 93.54, y),
      item(qty, 325.98, y),
      item("ea", 377.01, y),
      item(unitPrice, 428.03, y),
      item(amount, 501.73, y),
    ];
  }

  it("a page with no table doesn't turn its totals rows into fields", async () => {
    const result = await readPage(
      pageOf([
        item("Acme Supplies", 42, 785),
        item("Tax Invoice", 42, 765),
        item("Invoice No: A-1", 42, 745),
        item("Item", 42, 666),
        item("Product", 93, 666),
        item("Count", 326, 666),
        item("Subtotal: $1,270.00", 337, 558),
        item("GST (15%): $190.50", 337, 541),
        item("Total (incl GST): $1,501.80", 337, 524),
      ]),
      1,
      false,
    );

    expect(result.fields.map((f) => f.label)).toEqual(["Invoice No"]);
    expect(result.totals).toEqual({ subtotal: [], gst: [], total: [] });
  });

  it("an unreadable total below the table becomes a refusal on that page", async () => {
    const result = await readPage(
      pageOf([...HEADER, ...dataRow("A1", "Widget", "10", "$5.00", "$50.00", 643), item("Total: $1.501,80", 337, 600)]),
      1,
      false,
    );

    expect(result.pageRead.table?.lineItems).toHaveLength(1);
    expect(result.totals.total).toEqual([]);
    expect(result.refusals.map((f) => f.id)).toEqual(["totals:total:p1:unparseable"]);
  });

  it("refuses a line-item row stranded below a sub-heading instead of dropping it", async () => {
    const result = await readPage(
      pageOf([
        ...HEADER,
        ...dataRow("A1", "Widget A", "10", "$5.00", "$50.00", 643),
        ...dataRow("A2", "Widget B", "10", "$5.00", "$50.00", 626),
        item("Labour", 42.52, 590),
        ...dataRow("L1", "Install", "2", "$80.00", "$160.00", 573),
        item("Total: $260.00", 337, 540),
      ]),
      1,
      false,
    );

    expect(result.pageRead.table?.lineItems.map((i) => i.code)).toEqual(["A1", "A2"]);
    expect(result.refusals).toEqual([
      {
        id: "row:p1:after-table:1",
        code: "ROW_UNPARSEABLE",
        scope: "line",
        page: 1,
        lineItemId: null,
        subject: "Row on page 1",
        reason: "This row looks like a line item but sits outside the table we found, so we didn't use it.",
        evidence: [{ page: 1, sourceText: "L1 Install 2 ea $80.00 $160.00" }],
        calculation: null,
      },
    ]);
    expect(result.totals.total.map((t) => t.raw)).toEqual(["$260.00"]);
  });

  it("doesn't count a totals row laid out across the columns as a stranded line item", async () => {
    const result = await readPage(
      pageOf([
        ...HEADER,
        ...dataRow("A1", "Widget A", "10", "$5.00", "$50.00", 643),
        item("Subtotal: $50.00", 337, 600),
        item("Total (incl GST):", 93.54, 583),
        item("$57.50", 325.98, 583),
      ]),
      1,
      false,
    );

    expect(result.refusals).toEqual([]);
    expect(result.totals.total.map((t) => t.raw)).toEqual(["$57.50"]);
  });
});
