import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/extraction/extract";
import type { ExtractionResult } from "@/lib/extraction/schema";
import { assertTraceable } from "./support/assert-traceable";
import { buildPdf, invoice, text, totalLine, STANDARD_COLUMNS, type PageSpec } from "./support/build-pdf";

async function extract(pages: PageSpec[]): Promise<ExtractionResult> {
  const bytes = await buildPdf(pages);
  const result = await extractDocument(bytes, "edge.pdf");
  await assertTraceable(result, bytes);
  return result;
}

const ids = (r: ExtractionResult) => [...r.refusals.map((f) => f.id)].sort();
const ROWS = [
  ["AC-1", "Timber stud 90x45", "10", "length", "$12.50", "$125.00"],
  ["AC-2", "Nails 75mm", "2", "box", "$30.00", "$60.00"],
];
const TOTALS: Array<[string, string]> = [
  ["Subtotal:", "$185.00"],
  ["GST (15%):", "$27.75"],
  ["Total (incl GST):", "$212.75"],
];

describe("a clean generated invoice", () => {
  it("extracts completely, so the generator matches what the parser expects", async () => {
    const r = await extract([invoice({ rows: ROWS, totals: TOTALS })]);
    expect(r.outcome).toBe("complete");
    expect(r.lineItems).toHaveLength(2);
    expect(r.totals.total?.raw).toBe("$212.75");
  });
});

describe("layout variants", () => {
  it("accepts header synonyms (Quantity / Price / Line Total)", async () => {
    const columns = STANDARD_COLUMNS.map((c) =>
      ({ Qty: { ...c, label: "Quantity" }, "Unit Price": { ...c, label: "Price" }, Amount: { ...c, label: "Line Total" } })[c.label] ?? c,
    );
    const r = await extract([invoice({ columns, rows: ROWS, totals: TOTALS })]);
    expect(r.outcome).toBe("complete");
    expect(r.lineItems[0].amount?.raw).toBe("$125.00");
  });

  it("works without a Code column", async () => {
    const columns = STANDARD_COLUMNS.slice(1);
    const r = await extract([invoice({ columns, rows: ROWS.map((row) => row.slice(1)), totals: TOTALS })]);
    expect(r.outcome).toBe("complete");
    expect(r.lineItems[0].code).toBeNull();
  });

  it("doesn't call a discounted line wrong just because qty × price differs", async () => {
    const columns = [
      { x: 42.5, label: "Code" },
      { x: 93.5, label: "Description" },
      { x: 280, label: "Qty" },
      { x: 320, label: "Unit" },
      { x: 370, label: "Unit Price" },
      { x: 445, label: "Disc %" },
      { x: 501.7, label: "Amount" },
    ];
    const rows = [["AC-1", "Timber stud 90x45", "10", "length", "$12.50", "10%", "$112.50"]];
    const r = await extract([invoice({ columns, rows })]);
    expect(r.lineItems[0].amount?.raw).toBe("$112.50");
    expect(r.refusals.some((f) => f.code === "DOES_NOT_ADD_UP")).toBe(false);
  });

  it("keeps large figures with thousands separators and whole-dollar prices", async () => {
    const rows = [["AC-9", "Steel beam 310UB", "1,200", "m", "$52", "$62,400.00"]];
    const r = await extract([invoice({ title: "Delivery Docket", rows, totals: [["Subtotal:", "$62,400.00"]] })]);
    expect(r.lineItems[0].quantity?.value).toBe(1200);
    expect(r.totals.subtotal?.value).toBe(62400);
    expect(r.refusals).toEqual([]);
  });

  it("copes with non-ASCII descriptions", async () => {
    const rows = [["RB-12", "Ø12 rebar – 6m, ½ bundle", "4", "ea", "$9.50", "$38.00"]];
    const r = await extract([invoice({ rows })]);
    expect(r.lineItems[0].description).toBe("Ø12 rebar – 6m, ½ bundle");
  });
});

describe("messy cells are refused individually, the rest survives", () => {
  it("a credit line with a negative amount", async () => {
    const rows = [...ROWS, ["CR-1", "Returned nails", "1", "box", "$30.00", "-$30.00"]];
    const r = await extract([invoice({ rows })]);
    expect(r.lineItems).toHaveLength(3);
    expect(r.lineItems[2].amount).toBeNull();
    expect(ids(r)).toContain("value:p1-l3:amount");
    expect(r.lineItems[0].amount?.raw).toBe("$125.00");
  });

  it("an approximate quantity", async () => {
    const rows = [["AC-1", "Sand, bulk", "approx 20", "t", "$45.00", "$900.00"], ROWS[1]];
    const r = await extract([invoice({ rows })]);
    expect(r.lineItems[0].quantity).toBeNull();
    expect(r.refusals.find((f) => f.id === "value:p1-l1:quantity")?.reason).toContain('"approx 20"');
    expect(r.lineItems[1].quantity?.value).toBe(2);
  });

  it("a European-formatted amount", async () => {
    const rows = [["AC-1", "Timber stud 90x45", "10", "length", "$12,50", "$125,00"]];
    const r = await extract([invoice({ rows })]);
    expect(r.lineItems[0].unitPrice).toBeNull();
    expect(r.lineItems[0].amount).toBeNull();
  });

  it("a line with no amount under a real Amount column", async () => {
    const rows = [ROWS[0], ["AC-2", "Nails 75mm", "2", "box", "$30.00", null]];
    const r = await extract([invoice({ rows, totals: TOTALS })]);
    expect(ids(r)).toContain("missing:p1-l2:amount");
    // Can't check the subtotal against incomplete lines, so it must not be refused either.
    expect(r.totals.subtotal?.raw).toBe("$185.00");
  });
});

describe("arithmetic", () => {
  it("refuses a line whose amount isn't qty × price, and stops trusting the line sum", async () => {
    const rows = [ROWS[0], ["AC-2", "Nails 75mm", "2", "box", "$30.00", "$66.00"]];
    const r = await extract([invoice({ rows, totals: [["Subtotal:", "$191.00"]] })]);
    expect(r.lineItems[1].amount).toBeNull();
    expect(r.refusals.find((f) => f.id === "arith:p1-l2:amount")?.calculation).toBe("2 × $30.00 = $60.00");
    expect(ids(r)).not.toContain("arith:subtotal");
  });

  it("refuses a subtotal that doesn't match the lines", async () => {
    const r = await extract([invoice({ rows: ROWS, totals: [["Subtotal:", "$195.00"]] })]);
    expect(r.totals.subtotal).toBeNull();
    expect(ids(r)).toEqual(["arith:subtotal", "missing:gst"]);
  });

  it("refuses GST that isn't the stated rate of the subtotal", async () => {
    const totals: Array<[string, string]> = [["Subtotal:", "$185.00"], ["GST (15%):", "$28.75"], ["Total (incl GST):", "$213.75"]];
    const r = await extract([invoice({ rows: ROWS, totals })]);
    expect(r.totals.gst).toBeNull();
    expect(ids(r)).toContain("arith:gst");
  });

  it("uses the document's own GST rate (10% for an Australian invoice)", async () => {
    const totals: Array<[string, string]> = [["Subtotal:", "$185.00"], ["GST (10%):", "$18.50"], ["Total (incl GST):", "$203.50"]];
    const r = await extract([invoice({ rows: ROWS, totals })]);
    expect(r.outcome).toBe("complete");
    expect(r.totals.gst?.ratePercent).toBe(10);
  });

  it("treats 'Total (excl GST)' as the subtotal", async () => {
    const totals: Array<[string, string]> = [["Total (excl GST):", "$185.00"], ["GST (15%):", "$27.75"], ["Total (incl GST):", "$212.75"]];
    const r = await extract([invoice({ rows: ROWS, totals })]);
    expect(r.outcome).toBe("complete");
    expect(r.totals.subtotal?.raw).toBe("$185.00");
  });

  it("checks a bare Total against the lines when nothing else is stated", async () => {
    const r = await extract([invoice({ title: "Delivery Docket", rows: ROWS, totals: [["Total:", "$200.00"]] })]);
    expect(r.totals.total).toBeNull();
    expect(ids(r)).toEqual(["arith:total"]);
  });
});

describe("things the document says that we don't understand", () => {
  it("doesn't silently drop a labelled money figure it can't classify", async () => {
    const r = await extract([invoice({ rows: ROWS, totals: [...TOTALS, ["Amount due:", "$212.75"]] })]);
    const all = [...r.refusals, ...r.warnings];
    expect(all.some((f) => f.evidence.some((e) => e.sourceText.includes("Amount due")))).toBe(true);
  });

  it("flags two different counts of boxes but not the same count twice", async () => {
    const differ = await extract([invoice({ rows: ROWS, notes: ["Packed: 3 boxes", "Delivered: 4 boxes"] })]);
    expect(ids(differ)).toContain("count:box");
    const same = await extract([invoice({ rows: ROWS, notes: ["Packed: 3 boxes", "Delivered: 3 boxes"] })]);
    expect(ids(same)).not.toContain("count:box");
  });
});

describe("multi-page documents", () => {
  it("joins a table that continues onto a second page with its header repeated", async () => {
    const r = await extract([
      invoice({ rows: [ROWS[0]] }),
      invoice({ rows: [ROWS[1]], totals: TOTALS }),
    ]);
    expect(r.lineItems).toHaveLength(2);
    expect(r.outcome).toBe("complete");
  });

  it("refuses a continuation page without a header instead of guessing its columns", async () => {
    const r = await extract([
      invoice({ rows: [ROWS[0]] }),
      { lines: [text("Acme Trade Supplies Ltd", 0), text("Tax Invoice (continued)", 20), text(ROWS[1].join(" "), 40)] },
    ]);
    expect(r.lineItems).toHaveLength(1);
    expect(ids(r)).toContain("page:2:no-table");
  });

  it("contains a blank page and a scanned page between two good ones", async () => {
    const r = await extract([invoice({ rows: [ROWS[0]] }), { blank: true }, { image: true }, invoice({ rows: [ROWS[1]] })]);
    expect(r.lineItems).toHaveLength(2);
    expect(r.refusals.find((f) => f.id === "page:2:no-text")?.reason).toContain("has no readable text");
    expect(r.refusals.find((f) => f.id === "page:3:no-text")?.reason).toContain("scanned image");
  });

  it("doesn't raise warnings when every numbered invoice is present", async () => {
    const r = await extract([
      invoice({ title: "Statement - Invoice 1 of 2", rows: [ROWS[0]] }),
      invoice({ title: "Statement - Invoice 2 of 2", rows: [ROWS[1]] }),
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("refuses per-invoice subtotals rather than presenting one as the document's", async () => {
    const r = await extract([
      invoice({ title: "Statement - Invoice 1 of 2", rows: [ROWS[0]], totals: [["Subtotal:", "$125.00"]] }),
      invoice({ title: "Statement - Invoice 2 of 2", rows: [ROWS[1]], totals: [["Subtotal:", "$60.00"]] }),
    ]);
    expect(r.totals.subtotal).toBeNull();
    expect(ids(r)).toContain("totals:subtotal:per-page");
  });

  it("handles a 60-page document in reasonable time", async () => {
    const started = Date.now();
    const r = await extract(Array.from({ length: 60 }, () => invoice({ rows: ROWS })));
    expect(r.lineItems).toHaveLength(120);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);
});

describe("odd structure", () => {
  it("refuses a header with no rows under it", async () => {
    const r = await extract([invoice({ rows: [] })]);
    expect(r.outcome).toBe("nothing_extracted");
    expect(ids(r)).toContain("page:1:empty-table");
  });

  it("refuses a page with text but no table", async () => {
    const r = await extract([{ lines: [text("Acme Trade Supplies Ltd", 0), text("Cover letter", 20), text("Please find our invoice attached.", 30)] }]);
    expect(r.outcome).toBe("nothing_extracted");
    expect(ids(r)).toEqual(["page:1:no-table"]);
  });

  it("never invents numbers from a rotated page", async () => {
    const page = invoice({ rows: ROWS, totals: TOTALS }) as { lines: never[]; rotate?: number };
    const r = await extract([{ ...page, rotate: 90 }]);
    // Either read correctly or refused; assertTraceable already guarantees no invented values.
    if (r.lineItems.length) expect(r.lineItems[0].amount?.raw).toBe("$125.00");
  });

  it("totals line before the table is still read", async () => {
    const spec = invoice({ rows: ROWS, fields: [["Document No", "AC-1"]] }) as { lines: ReturnType<typeof text>[] };
    spec.lines.splice(3, 0, totalLine("Total due:", "$185.00", 14));
    const r = await extract([spec]);
    expect(r.totals.total?.raw).toBe("$185.00");
  });
});
