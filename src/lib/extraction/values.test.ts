import { describe, it, expect } from "vitest";
import { parseMoney, parseQuantity, parsePercent, formatCents } from "./values";

describe("parseMoney", () => {
  it.each([
    ["$1,248.00", 124800, null],
    ["$74.00 /carton", 7400, "carton"],
    ["$0.02 /ea", 2, "ea"],
    ["1248.00", 124800, null],
    ["$40", 4000, null],
  ])("parses %s", (raw, cents, per) => {
    const result = parseMoney(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cents).toBe(cents);
      expect(result.value.per).toBe(per);
    }
  });

  it.each([
    "$1.248,00", // European separators
    "$12,48.00", // bad grouping
    "~$40",
    "$40-50",
    "TBC",
    "",
    "-$5.00",
    "($5.00)",
  ])("refuses %j", (raw) => {
    const result = parseMoney(raw);
    expect(result.ok).toBe(false);
  });

  it("explains European separators in plain English", () => {
    const result = parseMoney("$1.248,00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toMatch(/comma/i);
    }
  });

  it("explains why negative amounts are refused", () => {
    const result = parseMoney("-$5.00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toMatch(/negative/i);
    }
  });
});

describe("parseQuantity", () => {
  it.each([
    ["24", 24],
    ["2000", 2000],
    ["1,200", 1200],
    ["2.5", 2.5],
    ["0", 0],
  ])("parses %s", (raw, value) => {
    const result = parseQuantity(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(value);
    }
  });

  it.each(["approx 20", "20kg", "-3", ""])("refuses %j", (raw) => {
    const result = parseQuantity(raw);
    expect(result.ok).toBe(false);
  });

  it("explains why negative quantities are refused", () => {
    const result = parseQuantity("-3");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.why).toMatch(/negative/i);
    }
  });
});

describe("parsePercent", () => {
  it.each([
    ["GST (15%):", 15],
    ["GST 12.5%", 12.5],
    ["Total", null],
    ["Amount due", null],
  ])("parses %s", (label, expected) => {
    expect(parsePercent(label)).toBe(expected);
  });
});

describe("formatCents", () => {
  it.each([
    [146050, "$1,460.50"],
    [0, "$0.00"],
    [50, "$0.50"],
    [-100, "-$1.00"],
  ])("formats %d", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});
