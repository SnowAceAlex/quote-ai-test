import { describe, it, expect } from "vitest";
import { parseTable } from "./table";
import { loadPdf } from "./pdf";
import { buildRows, type Row } from "./rows";
import type { TextItem } from "./pdf";
import type { LineItem } from "./schema";
import { loadSample } from "./test-helpers";

// Every sourced field must point back into the row it came from.
function expectRawTracesToRow(item: LineItem) {
  const source = item.evidence.sourceText;
  if (item.quantity) expect(source).toContain(item.quantity.raw);
  if (item.unitPrice) expect(source).toContain(item.unitPrice.raw);
  if (item.amount) expect(source).toContain(item.amount.raw);
  for (const other of item.otherColumns) expect(source).toContain(other.raw);
}

describe("parseTable on samples", () => {
  it("IB-55871: 4 items, item 1 has quantity/unitPrice/amount evidence", async () => {
    const pdf = await loadPdf(loadSample("IB-55871.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(4);
    expect(table.headerIndex).toBe(6);
    expect(table.endIndex).toBe(12); // "Subtotal:" row

    const first = table.lineItems[0];
    expect(first.id).toBe("p1-l1");
    expect(first.code).toBe("FX-201");
    expect(first.quantity?.value).toBe(24);
    expect(first.unitPrice?.value).toBe(52);
    expect(first.amount?.value).toBe(1248);
    expect(first.amount?.raw).toBe("$1,248.00");

    for (const item of table.lineItems) expectRawTracesToRow(item);
    expect(table.rowFindings).toHaveLength(0);
  });

  it("IB-56010: 4 items, no Amount column, unitPrice.per varies, Weight carried as otherColumns", async () => {
    const pdf = await loadPdf(loadSample("IB-56010.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(4);
    for (const item of table.lineItems) {
      expect(item.amount).toBeNull();
      expectRawTracesToRow(item);
    }

    expect(table.lineItems.map((item) => item.unitPrice?.per)).toEqual(["carton", "ea", "kit", "tub"]);

    const fx402 = table.lineItems.find((item) => item.code === "FX-402");
    expect(fx402?.otherColumns[0]).toEqual({
      label: "Weight",
      raw: "640g total",
      evidence: { page: 1, sourceText: fx402?.evidence.sourceText },
    });
  });

  it("IB-56088: exactly 3 items, the Warehouse notes footer is not a row", async () => {
    const pdf = await loadPdf(loadSample("IB-56088.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(3);
    expect(table.endIndex).toBe(12); // "Warehouse notes:" row
    for (const item of table.lineItems) expectRawTracesToRow(item);
  });

  it("IB-56150: 4 items, Subtotal/GST/Total are not rows", async () => {
    const pdf = await loadPdf(loadSample("IB-56150.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(4);
    for (const item of table.lineItems) expectRawTracesToRow(item);
  });

  it("IB-STMT47 page 1: 3 items, page footer ends the table by distance", async () => {
    const pdf = await loadPdf(loadSample("IB-STMT47.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(3);
    expect(table.endIndex).toBe(9); // "Page 1 of 8" row, well past 1.5x the row gap
    for (const item of table.lineItems) expectRawTracesToRow(item);
  });
});

describe("parseTable on synthetic rows", () => {
  function item(str: string, x: number, y: number): TextItem {
    return { str, x, y, width: 10 };
  }

  const HEADER = [
    item("Code", 42.52, 700),
    item("Description", 93.54, 700),
    item("Qty", 325.98, 700),
    item("Unit", 377.01, 700),
    item("Unit Price", 428.03, 700),
    item("Amount", 501.73, 700),
  ];
  const RULE = [item("-".repeat(100), 42.52, 677.32)];

  function dataRow(code: string, description: string, qty: string, unit: string, unitPrice: string, amount: string, y: number): TextItem[] {
    return [
      item(code, 42.52, y),
      item(description, 93.54, y),
      item(qty, 325.98, y),
      item(unit, 377.01, y),
      item(unitPrice, 428.03, y),
      item(amount, 501.73, y),
    ];
  }

  function rowsFrom(items: TextItem[][]): Row[] {
    return buildRows(items.flat());
  }

  it("a row with an unparseable qty cell yields quantity: null plus a VALUE_UNPARSEABLE finding, neighbours intact", () => {
    const rows = rowsFrom([
      HEADER,
      RULE,
      dataRow("FX-001", "Widget A", "10", "ea", "$5.00", "$50.00", 660.32),
      dataRow("FX-002", "Widget B", "approx 20", "ea", "$5.00", "$100.00", 643.31),
      dataRow("FX-003", "Widget C", "30", "ea", "$5.00", "$150.00", 626.30),
    ]);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(3);
    const [first, second, third] = table.lineItems;
    expect(first.quantity?.value).toBe(10);
    expect(second.quantity).toBeNull();
    expect(third.quantity?.value).toBe(30);

    expect(table.rowFindings).toHaveLength(1);
    const finding = table.rowFindings[0];
    expect(finding.code).toBe("VALUE_UNPARSEABLE");
    expect(finding.id).toBe("value:p1-l2:quantity");
    expect(finding.lineItemId).toBe("p1-l2");
    expect(finding.reason).toBe('The quantity "approx 20" isn\'t a plain number, so we didn\'t use it.');
    expect(finding.evidence).toEqual([{ page: 1, sourceText: second.evidence.sourceText }]);
  });

  it("a row missing its qty cell entirely produces one ROW_UNPARSEABLE finding, neighbours intact", () => {
    const y2 = 643.31;
    const rowWithoutQty = [
      item("FX-002", 42.52, y2),
      item("Widget B", 93.54, y2),
      // no Qty item at x=325.98
      item("ea", 377.01, y2),
      item("$5.00", 428.03, y2),
      item("$100.00", 501.73, y2),
    ];

    const rows = rowsFrom([
      HEADER,
      RULE,
      dataRow("FX-001", "Widget A", "10", "ea", "$5.00", "$50.00", 660.32),
      rowWithoutQty,
      dataRow("FX-003", "Widget C", "30", "ea", "$5.00", "$150.00", 626.30),
    ]);

    const table = parseTable(rows, 1);
    expect(table).not.toBeNull();
    if (!table) return;

    expect(table.lineItems).toHaveLength(2);
    expect(table.lineItems.map((i) => i.code)).toEqual(["FX-001", "FX-003"]);
    // the skipped row still consumes number 2, so the surviving items are l1 and l3
    expect(table.lineItems.map((i) => i.id)).toEqual(["p1-l1", "p1-l3"]);

    expect(table.rowFindings).toHaveLength(1);
    const finding = table.rowFindings[0];
    expect(finding.code).toBe("ROW_UNPARSEABLE");
    expect(finding.id).toBe("row:p1-l2");
    expect(finding.lineItemId).toBeNull();
    expect(finding.subject).toBe("Row 2 on page 1");
    expect(finding.reason).toBe("This row has no quantity, so we didn't treat it as a line item.");
  });

  it("returns null when no row has both Description and Qty headers", () => {
    const rows = rowsFrom([
      [item("Notes", 42.52, 700)],
      [item("Just some text", 42.52, 680)],
    ]);

    expect(parseTable(rows, 1)).toBeNull();
  });
});
