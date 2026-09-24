import { describe, it, expect } from "vitest";
import { readTitle, readFields, readTotals, freeTextRows } from "./document";
import type { Row } from "./rows";
import type { TableParse } from "./table";

function row(text: string): Row {
  return { y: 0, items: [], text };
}

function fakeTable(headerIndex: number, endIndex: number): TableParse {
  return { header: row("header"), columns: [], lineItems: [], rowFindings: [], headerIndex, endIndex };
}

describe("readTitle", () => {
  it("returns the row directly under the company name", () => {
    const rows = [row("Ironbark Trade Merchants Ltd"), row("Tax Invoice"), row("Document No: IB-55871")];
    expect(readTitle(rows)).toBe("Tax Invoice");
  });

  it("returns null when there is no second row", () => {
    expect(readTitle([row("Ironbark Trade Merchants Ltd")])).toBeNull();
    expect(readTitle([])).toBeNull();
  });
});

describe("readFields", () => {
  const above = [
    row("Ironbark Trade Merchants Ltd"),
    row("Tax Invoice"),
    row("Document No: IB-55871"),
    row("Date: 5 August 2026"),
    row("Bill to: Coastal Build Co"),
    row("Job ref: CB-2216"),
  ];

  it("reads Label: value rows, skipping the company and title rows", () => {
    expect(readFields(above, 1)).toEqual([
      { label: "Document No", raw: "IB-55871", evidence: { page: 1, sourceText: "Document No: IB-55871" } },
      { label: "Date", raw: "5 August 2026", evidence: { page: 1, sourceText: "Date: 5 August 2026" } },
      { label: "Bill to", raw: "Coastal Build Co", evidence: { page: 1, sourceText: "Bill to: Coastal Build Co" } },
      { label: "Job ref", raw: "CB-2216", evidence: { page: 1, sourceText: "Job ref: CB-2216" } },
    ]);
  });

  it("rejects a value ending with a period", () => {
    const rows = [row("Company"), row("Title"), row("Summary: 9 cartons dispatched from Ironbark warehouse this run.")];
    expect(readFields(rows, 1)).toEqual([]);
  });

  it("rejects a label longer than 3 words", () => {
    const rows = [row("Company"), row("Title"), row("This label has way too many words: value")];
    expect(readFields(rows, 1)).toEqual([]);
  });

  it("ignores rows without a colon", () => {
    const rows = [row("Company"), row("Title"), row("Payment due 20 days from invoice date.")];
    expect(readFields(rows, 1)).toEqual([]);
  });
});

describe("readTotals", () => {
  it("reads Subtotal/GST/Total rows, deriving GST rate and includesGst true", () => {
    const rows = [row("Subtotal: $3,259.00"), row("GST (15%): $488.85"), row("Total (incl GST): $3,747.85")];
    const totals = readTotals(rows, 1);

    expect(totals.subtotal).toEqual({
      value: 3259,
      raw: "$3,259.00",
      per: null,
      evidence: { page: 1, sourceText: "Subtotal: $3,259.00" },
    });
    expect(totals.gst).toEqual({
      value: 488.85,
      raw: "$488.85",
      per: null,
      ratePercent: 15,
      evidence: { page: 1, sourceText: "GST (15%): $488.85" },
    });
    expect(totals.total).toEqual({
      value: 3747.85,
      raw: "$3,747.85",
      per: null,
      includesGst: true,
      evidence: { page: 1, sourceText: "Total (incl GST): $3,747.85" },
    });
  });

  it("sets includesGst false for a label that says excl GST", () => {
    const totals = readTotals([row("Total (excl GST): $1,270.00")], 1);
    expect(totals.total?.includesGst).toBe(false);
  });

  it("a Total line with no incl/excl wording leaves includesGst null and is not mistaken for the GST line", () => {
    const totals = readTotals([row("Total: $2,050.00")], 1);
    expect(totals.total?.includesGst).toBeNull();
    expect(totals.gst).toBeNull();
  });

  it("ignores rows whose value after the colon has more than one token, even if it starts with a number", () => {
    const rows = [
      row("Warehouse notes: 11 cartons picked and loaded onto the truck."),
      row("Payment due 20 days from invoice date."),
    ];
    expect(readTotals(rows, 1)).toEqual({ subtotal: null, gst: null, total: null });
  });

  it("leaves a kind null when its value doesn't parse as money", () => {
    const totals = readTotals([row("Total: see attached schedule")], 1);
    expect(totals.total).toBeNull();
  });
});

describe("freeTextRows", () => {
  it("excludes rows 0-1, the table span, and totals rows, keeping the rest", () => {
    const rows = [
      row("Ironbark Trade Merchants Ltd"),
      row("Tax Invoice"),
      row("Summary: 9 cartons dispatched from Ironbark warehouse this run."),
      row("Code Description Qty Unit Unit Price Amount"),
      row("FX-201 Framing nail gun 24 box $52.00 $1,248.00"),
      row("Warehouse notes: 11 cartons picked and loaded onto the truck."),
      row("Total: $2,050.00"),
    ];

    const texts = freeTextRows(rows, fakeTable(3, 5)).map((r) => r.text);
    expect(texts).toEqual([
      "Summary: 9 cartons dispatched from Ironbark warehouse this run.",
      "Warehouse notes: 11 cartons picked and loaded onto the truck.",
    ]);
  });

  it("with no table, excludes only rows 0-1 and totals rows", () => {
    const rows = [row("Company"), row("Title"), row("Notes here"), row("Total: $10.00")];
    expect(freeTextRows(rows, null).map((r) => r.text)).toEqual(["Notes here"]);
  });

  it("still includes Label: value field rows (they belong to both fields and free text)", () => {
    const rows = [row("Company"), row("Title"), row("Document No: IB-1")];
    expect(freeTextRows(rows, null).map((r) => r.text)).toEqual(["Document No: IB-1"]);
  });
});
