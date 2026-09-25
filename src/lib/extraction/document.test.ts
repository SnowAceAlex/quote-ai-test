import { describe, it, expect } from "vitest";
import {
  readTitle,
  readFields,
  readTotals,
  freeTextRows,
  matchTotalsRow,
  matchTotalsLabel,
  mergeTotals,
  type StatedTotals,
} from "./document";
import { buildRows, type Row } from "./rows";
import type { TableParse } from "./table";
import type { SourcedMoney } from "./schema";

function row(text: string): Row {
  return { y: 0, items: [], text };
}

function cellsRow(...cells: string[]): Row {
  return buildRows(cells.map((str, i) => ({ str, x: 40 + i * 100, y: 0, width: 10 })))[0];
}

function fakeTable(headerIndex: number, endIndex: number): TableParse {
  return { header: row("header"), columns: [], lineItems: [], rowFindings: [], headerIndex, endIndex, measureLabels: [] };
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

  it("skips totals rows, which reach it when the page has no table", () => {
    const rows = [
      row("Acme Supplies"),
      row("Tax Invoice"),
      row("Invoice No: A-1"),
      row("Subtotal: $1,270.00"),
      row("GST (15%): $190.50"),
      row("Total (incl GST): $1,501.80"),
      row("Total: TBC"),
    ];
    expect(readFields(rows, 1).map((f) => f.label)).toEqual(["Invoice No"]);
  });
});

describe("matchTotalsRow", () => {
  it.each([
    ["Subtotal: $1.00", "subtotal"],
    ["Sub-total: $1.00", "subtotal"],
    ["SUBTOTAL: $1.00", "subtotal"],
    ["Sub Total: $1.00", "subtotal"],
    ["Total (excl GST): $1.00", "subtotal"],
    ["Total excl. GST: $1.00", "subtotal"],
    ["GST: $1.00", "gst"],
    ["GST (15%): $1.00", "gst"],
    ["GST (12.5%): $1.00", "gst"],
    ["GST 15%: $1.00", "gst"],
    ["Total: $1.00", "total"],
    ["Grand total: $1.00", "total"],
    ["Total (incl GST): $1.00", "total"],
    ["Total incl. GST: $1.00", "total"],
    ["Total due: $1.00", "total"],
    ["TOTAL PAYABLE: $1.00", "total"],
  ])("reads %j as a %s row", (text, kind) => {
    expect(matchTotalsRow(row(text))?.kind).toBe(kind);
  });

  it.each([
    "Total cartons: 11",
    "GST No: 111222333",
    "Total consignment weight: see individual lines.",
    "Warehouse notes: 11 cartons picked and loaded onto the truck.",
    "Payment due 20 days from invoice date.",
    "Subtotals: $1.00",
  ])("leaves %j alone", (text) => {
    expect(matchTotalsRow(row(text))).toBeNull();
  });

  it("splits the label from the value at the colon", () => {
    expect(matchTotalsRow(row("Total (incl GST): $3,747.85"))).toEqual({
      kind: "total",
      label: "Total (incl GST)",
      raw: "$3,747.85",
    });
  });

  it("reads a colon-less totals label in its own first cell", () => {
    expect(matchTotalsRow(cellsRow("Total", "15", "$75.00"))).toEqual({ kind: "total", label: "Total", raw: "15 $75.00" });
    expect(matchTotalsRow(cellsRow("Sub Total", "$50.00"))).toEqual({ kind: "subtotal", label: "Sub Total", raw: "$50.00" });
  });

  it("leaves a totals word alone when it isn't the whole first cell", () => {
    expect(matchTotalsRow(cellsRow("Widget", "Total", "$5.00"))).toBeNull();
    expect(matchTotalsRow(cellsRow("Total", "qty: 10"))).toBeNull();
  });
});

describe("matchTotalsLabel", () => {
  it.each([
    ["Total", "total"],
    ["Sub-total", "subtotal"],
    ["GST (15%)", "gst"],
    ["Total qty", null],
    ["Total:", null],
  ])("reads %j as %s", (label, kind) => {
    expect(matchTotalsLabel(label)).toBe(kind);
  });
});

describe("readTotals", () => {
  it("reads Subtotal/GST/Total rows, deriving GST rate and includesGst true", () => {
    const rows = [row("Subtotal: $3,259.00"), row("GST (15%): $488.85"), row("Total (incl GST): $3,747.85")];
    const { stated, refusals } = readTotals(rows, 1);

    expect(stated.subtotal).toEqual([
      { value: 3259, raw: "$3,259.00", per: null, evidence: { page: 1, sourceText: "Subtotal: $3,259.00" } },
    ]);
    expect(stated.gst).toEqual([
      {
        value: 488.85,
        raw: "$488.85",
        per: null,
        ratePercent: 15,
        evidence: { page: 1, sourceText: "GST (15%): $488.85" },
      },
    ]);
    expect(stated.total).toEqual([
      {
        value: 3747.85,
        raw: "$3,747.85",
        per: null,
        includesGst: true,
        evidence: { page: 1, sourceText: "Total (incl GST): $3,747.85" },
      },
    ]);
    expect(refusals).toEqual([]);
  });

  it("reads a pre-GST total as the subtotal, keeping its own label in the evidence", () => {
    const { stated } = readTotals([row("Total (excl GST): $1,270.00")], 1);
    expect(stated.subtotal).toEqual([
      { value: 1270, raw: "$1,270.00", per: null, evidence: { page: 1, sourceText: "Total (excl GST): $1,270.00" } },
    ]);
    expect(stated.total).toEqual([]);
  });

  it("reads the rate from a GST 15% label", () => {
    const { stated } = readTotals([row("GST 15%: $190.50")], 1);
    expect(stated.gst[0]?.ratePercent).toBe(15);
  });

  it("a Total line with no incl wording leaves includesGst null and is not mistaken for the GST line", () => {
    const { stated } = readTotals([row("Total: $2,050.00"), row("Total due: $2,050.00")], 1);
    expect(stated.total.map((t) => t.includesGst)).toEqual([null, null]);
    expect(stated.gst).toEqual([]);
  });

  it("leaves Total cartons and GST No alone instead of reading them as money", () => {
    const rows = [row("Total cartons: 11"), row("Total: $2,050.00"), row("GST No: 111222333")];
    const { stated, refusals } = readTotals(rows, 1);
    expect(stated.subtotal).toEqual([]);
    expect(stated.gst).toEqual([]);
    expect(stated.total.map((t) => t.raw)).toEqual(["$2,050.00"]);
    expect(refusals).toEqual([]);
  });

  it("ignores free-text rows with colons", () => {
    const rows = [
      row("Warehouse notes: 11 cartons picked and loaded onto the truck."),
      row("Payment due 20 days from invoice date."),
    ];
    expect(readTotals(rows, 1)).toEqual({
      stated: { subtotal: [], gst: [], total: [], unreadable: { subtotal: [], gst: [], total: [] } },
      refusals: [],
    });
  });

  it("returns every statement of a kind, not just the first", () => {
    const { stated } = readTotals([row("Total: $2,050.00"), row("Total due: $2,100.00")], 1);
    expect(stated.total.map((t) => t.raw)).toEqual(["$2,050.00", "$2,100.00"]);
  });

  it("refuses a totals row whose value is in a money format we won't guess at", () => {
    const { stated, refusals } = readTotals([row("Total: $1.501,80")], 2);
    expect(stated.total).toEqual([]);
    expect(refusals).toEqual([
      {
        id: "totals:total:p2:unparseable",
        code: "VALUE_UNPARSEABLE",
        scope: "field",
        page: 2,
        lineItemId: null,
        subject: "Total",
        reason: 'The total "$1.501,80" uses a comma as the decimal separator, so we didn\'t use it.',
        evidence: [{ page: 2, sourceText: "Total: $1.501,80" }],
        calculation: null,
      },
    ]);
  });

  it("refuses a totals value with no dollar sign", () => {
    const { stated, refusals } = readTotals([row("Subtotal: 2050.00")], 1);
    expect(stated.subtotal).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ id: "totals:subtotal:p1:unparseable", subject: "Subtotal" });
    expect(refusals[0].reason).toBe('The subtotal "2050.00" has no dollar sign to show it\'s money, so we didn\'t use it.');
  });

  it("refuses a totals value that isn't money at all", () => {
    const { stated, refusals } = readTotals([row("GST: TBC"), row("Total: see attached schedule")], 1);
    expect(stated.gst).toEqual([]);
    expect(stated.total).toEqual([]);
    expect(refusals.map((f) => [f.id, f.subject])).toEqual([
      ["totals:gst:p1:unparseable", "GST"],
      ["totals:total:p1:unparseable", "Total"],
    ]);
  });

  it("says a totals label with nothing after it is blank", () => {
    const { refusals } = readTotals([row("Total:")], 1);
    expect(refusals.map((f) => f.reason)).toEqual(["The total is blank, so we didn't use it."]);
  });

  it("gives two unreadable totals on one page different ids", () => {
    const { refusals } = readTotals([row("Total: TBC"), row("Total due: TBC")], 1);
    expect(refusals.map((f) => f.id)).toEqual(["totals:total:p1:unparseable", "totals:total:p1:unparseable:2"]);
  });

  it("reports each unreadable statement under its kind", () => {
    const { stated } = readTotals([row("Total: TBC"), row("GST: $1.00")], 3);
    expect(stated.unreadable).toEqual({
      subtotal: [],
      gst: [],
      total: [{ raw: "TBC", evidence: { page: 3, sourceText: "Total: TBC" } }],
    });
  });
});

describe("mergeTotals", () => {
  function money(raw: string, value: number, page: number, label = "Total"): SourcedMoney {
    return { value, raw, per: null, evidence: { page, sourceText: `${label}: ${raw}` } };
  }

  const noneUnreadable = { subtotal: [], gst: [], total: [] };

  function statedTotal(...values: SourcedMoney[]): StatedTotals {
    return { subtotal: [], gst: [], total: values.map((v) => ({ ...v, includesGst: null })), unreadable: noneUnreadable };
  }

  function statedSubtotal(...values: SourcedMoney[]): StatedTotals {
    return { subtotal: values, gst: [], total: [], unreadable: noneUnreadable };
  }

  function readPageTotals(page: number, ...texts: string[]): StatedTotals {
    return readTotals(texts.map(row), page).stated;
  }

  it("keeps a figure the whole document states once", () => {
    const { totals, refusals } = mergeTotals([statedTotal(), statedTotal(money("$100.00", 100, 2))]);
    expect(totals.total?.raw).toBe("$100.00");
    expect(totals.total?.evidence.page).toBe(2);
    expect(refusals).toEqual([]);
  });

  it("keeps the first when one page repeats the same figure", () => {
    const first = money("$100.00", 100, 1, "Total");
    const { totals, refusals } = mergeTotals([statedTotal(first, money("$100.00", 100, 1, "Total due"))]);
    expect(totals.total?.evidence.sourceText).toBe("Total: $100.00");
    expect(refusals).toEqual([]);
  });

  it("refuses a kind one page states with two different figures", () => {
    const { totals, refusals } = mergeTotals([
      statedTotal(money("$2,050.00", 2050, 1, "Total"), money("$2,100.00", 2100, 1, "Total due")),
    ]);
    expect(totals.total).toBeNull();
    expect(refusals).toEqual([
      {
        id: "totals:total:conflict",
        code: "CONTRADICTION",
        scope: "document",
        page: 1,
        lineItemId: null,
        subject: "Total",
        reason: "Total is stated as $2,050.00 and $2,100.00 on page 1, so we can't tell which is right.",
        evidence: [
          { page: 1, sourceText: "Total: $2,050.00" },
          { page: 1, sourceText: "Total due: $2,100.00" },
        ],
        calculation: null,
      },
    ]);
  });

  it("refuses a kind stated on more than one page, even when the figures match", () => {
    const { totals, refusals } = mergeTotals([
      statedSubtotal(money("$327.00", 327, 1, "Subtotal")),
      statedSubtotal(money("$327.00", 327, 2, "Subtotal")),
      statedSubtotal(money("$327.00", 327, 3, "Subtotal")),
    ]);
    expect(totals.subtotal).toBeNull();
    expect(refusals).toEqual([
      {
        id: "totals:subtotal:per-page",
        code: "AMBIGUOUS",
        scope: "document",
        page: null,
        lineItemId: null,
        subject: "Subtotal",
        reason:
          "Pages 1, 2 and 3 each state a subtotal ($327.00, $327.00, $327.00). They may be totals for separate invoices, so we haven't reported one subtotal for the whole document.",
        evidence: [
          { page: 1, sourceText: "Subtotal: $327.00" },
          { page: 2, sourceText: "Subtotal: $327.00" },
          { page: 3, sourceText: "Subtotal: $327.00" },
        ],
        calculation: null,
      },
    ]);
  });

  it("refuses per page rather than as a contradiction when pages disagree", () => {
    const { totals, refusals } = mergeTotals([
      statedTotal(money("$100.00", 100, 1)),
      statedTotal(money("$150.00", 150, 2)),
    ]);
    expect(totals.total).toBeNull();
    expect(refusals.map((f) => [f.id, f.code])).toEqual([["totals:total:per-page", "AMBIGUOUS"]]);
    expect(refusals[0].reason).toContain("Pages 1 and 2 each state a total ($100.00, $150.00)");
    expect(refusals[0].evidence).toHaveLength(2);
  });

  it("names the GST figure in a per-page refusal", () => {
    const gst = (page: number) => ({ ...money("$15.00", 15, page, "GST"), ratePercent: null });
    const { refusals } = mergeTotals([
      { subtotal: [], gst: [gst(1)], total: [], unreadable: noneUnreadable },
      { subtotal: [], gst: [gst(2)], total: [], unreadable: noneUnreadable },
    ]);
    expect(refusals[0].reason).toBe(
      "Pages 1 and 2 each state a GST amount ($15.00, $15.00). They may be totals for separate invoices, so we haven't reported one GST amount for the whole document.",
    );
  });

  it("leaves a kind null with no refusal when no page states it", () => {
    const { totals, refusals } = mergeTotals([statedTotal()]);
    expect(totals).toEqual({ subtotal: null, gst: null, total: null });
    expect(refusals).toEqual([]);
  });

  it("counts an unreadable total on one page against a readable one on another", () => {
    const { totals, refusals } = mergeTotals([readPageTotals(1, "Total: TBC"), readPageTotals(2, "Total: $4.00")]);
    expect(totals.total).toBeNull();
    expect(refusals).toEqual([
      {
        id: "totals:total:per-page",
        code: "AMBIGUOUS",
        scope: "document",
        page: null,
        lineItemId: null,
        subject: "Total",
        reason:
          "Pages 1 and 2 each state a total (TBC, $4.00). They may be totals for separate invoices, so we haven't reported one total for the whole document.",
        evidence: [
          { page: 1, sourceText: "Total: TBC" },
          { page: 2, sourceText: "Total: $4.00" },
        ],
        calculation: null,
      },
    ]);
  });

  it("names both figures when an unreadable total blocks a readable one on the same page", () => {
    const { totals, refusals } = mergeTotals([readPageTotals(1, "Total: $1.501,80", "Total due: $1,400.00")]);
    expect(totals.total).toBeNull();
    expect(refusals).toEqual([
      {
        id: "totals:total:conflict",
        code: "CONTRADICTION",
        scope: "document",
        page: 1,
        lineItemId: null,
        subject: "Total",
        reason: 'Page 1 states the total as $1,400.00 and also as "$1.501,80", which we couldn\'t read, so we didn\'t use either.',
        evidence: [
          { page: 1, sourceText: "Total due: $1,400.00" },
          { page: 1, sourceText: "Total: $1.501,80" },
        ],
        calculation: null,
      },
    ]);
  });

  it("still reports two readable figures that disagree next to an unreadable one", () => {
    const { totals, refusals } = mergeTotals([readPageTotals(1, "Total: TBC", "Total: $5.00", "Total due: $6.00")]);
    expect(totals.total).toBeNull();
    expect(refusals.map((f) => f.id)).toEqual(["totals:total:conflict"]);
  });

  it("keeps the first of two matching totals but takes incl GST from either label", () => {
    const { totals, refusals } = mergeTotals([readPageTotals(1, "Total due: $57.50", "Total (incl GST): $57.50")]);
    expect(totals.total).toEqual({
      value: 57.5,
      raw: "$57.50",
      per: null,
      includesGst: true,
      evidence: { page: 1, sourceText: "Total due: $57.50" },
    });
    expect(refusals).toEqual([]);
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
