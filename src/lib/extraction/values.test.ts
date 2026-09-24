import { describe, it, expect } from "vitest";
import { parseMoney, parseQuantity, parsePercent, formatCents, refusalReason, type Parsed } from "./values";

function refusalSentence(field: string, raw: string, result: Parsed<unknown>): string {
  if (result.ok) throw new Error(`expected "${raw}" to be refused`);
  return refusalReason(field, raw, result.why);
}

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

  it.each([
    ["-$5.00", `The amount "-$5.00" is negative, which we don't handle, so we didn't use it.`],
    [
      "($5.00)",
      `The amount "($5.00)" is in brackets, which usually means a credit and we don't infer that, so we didn't use it.`,
    ],
    ["$1.248,00", `The amount "$1.248,00" uses a comma as the decimal separator, so we didn't use it.`],
    ["TBC", `The amount "TBC" isn't a plain money amount, so we didn't use it.`],
    ["", "The amount is blank, so we didn't use it."],
  ])("explains refusing %j in a sentence", (raw, sentence) => {
    expect(refusalSentence("amount", raw, parseMoney(raw))).toBe(sentence);
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

  it.each([
    ["-3", `The quantity "-3" is negative, which we don't handle, so we didn't use it.`],
    ["approx 20", `The quantity "approx 20" isn't a plain number, so we didn't use it.`],
  ])("explains refusing %j in a sentence", (raw, sentence) => {
    expect(refusalSentence("quantity", raw, parseQuantity(raw))).toBe(sentence);
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
