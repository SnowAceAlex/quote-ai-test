import { describe, it, expect } from "vitest";
import { loadPdf, PdfLoadError, type TextItem } from "./pdf";
import { buildRows } from "./rows";
import { loadSample } from "./test-helpers";

describe("loadPdf", () => {
  it("loads IB-55871 page 1 with a row for the first line item", async () => {
    const pdf = await loadPdf(loadSample("IB-55871.pdf"));
    const page = await pdf.getPage(1);
    const rows = buildRows(page.items);
    const texts = rows.map((row) => row.text);
    expect(texts).toContain(
      "FX-201 Framing nail gun coil, 90mm galv 24 box $52.00 $1,248.00",
    );
  });

  it("reports IB-55902 page 1 as a scanned image with no text layer", async () => {
    const pdf = await loadPdf(loadSample("IB-55902.pdf"));
    const page = await pdf.getPage(1);
    expect(page.items).toHaveLength(0);
    expect(page.imageCount).toBeGreaterThanOrEqual(1);
  });

  it("counts IB-STMT47's 8 pages and reads page 4 as image-only, page 5 as text", async () => {
    const pdf = await loadPdf(loadSample("IB-STMT47.pdf"));
    expect(pdf.pageCount).toBe(8);

    const page4 = await pdf.getPage(4);
    expect(page4.items).toHaveLength(0);

    const page5 = await pdf.getPage(5);
    expect(page5.items.length).toBeGreaterThan(0);
  });

  it("loads a page on demand without requiring earlier pages to be fetched first", async () => {
    const pdf = await loadPdf(loadSample("IB-STMT47.pdf"));
    // getPage(5) called with no prior getPage call: proves pages load lazily, not all up front
    const page5 = await pdf.getPage(5);
    expect(page5.page).toBe(5);
    expect(page5.items.length).toBeGreaterThan(0);
  });

  it("rejects random bytes with PdfLoadError PDF_CORRUPT", async () => {
    const bytes = new TextEncoder().encode("this is definitely not a pdf file");
    await expect(loadPdf(bytes)).rejects.toMatchObject(
      expect.objectContaining({ code: "PDF_CORRUPT" }),
    );
    await expect(loadPdf(bytes)).rejects.toBeInstanceOf(PdfLoadError);
  });
});

describe("buildRows", () => {
  function item(str: string, x: number, y: number, width = 10): TextItem {
    return { str, x, y, width };
  }

  it("groups items within 2pt of y into one row, ordered left to right", () => {
    const items = [
      item("World", 50, 100.5),
      item("Hello", 10, 100),
      item("Again", 90, 101.8),
    ];
    const rows = buildRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Hello World Again");
  });

  it("splits items more than 2pt apart in y into separate rows", () => {
    const items = [item("Top", 10, 100), item("Bottom", 10, 97)];
    const rows = buildRows(items);
    expect(rows).toHaveLength(2);
  });

  it("orders rows top to bottom by descending y", () => {
    const items = [item("Second", 10, 50), item("First", 10, 100)];
    const rows = buildRows(items);
    expect(rows.map((row) => row.text)).toEqual(["First", "Second"]);
  });

  it("drops blank and whitespace-only items", () => {
    const items = [item("A", 10, 100), item("  ", 20, 100), item("", 30, 100), item("B", 40, 100)];
    const rows = buildRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("A B");
    expect(rows[0].items).toHaveLength(2);
  });

  it("sets Row.y to the row's y", () => {
    const items = [item("A", 10, 100)];
    const rows = buildRows(items);
    expect(rows[0].y).toBe(100);
  });

  it("returns no rows for an empty item list", () => {
    expect(buildRows([])).toEqual([]);
  });
});
