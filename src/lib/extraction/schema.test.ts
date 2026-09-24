import { describe, it, expect } from "vitest";
import { ExtractionResult, SourcedNumber } from "./schema";

describe("ExtractionResult schema", () => {
  it("accepts a minimal valid result", () => {
    const minimalResult = {
      fileName: "test.pdf",
      pageCount: 1,
      outcome: "complete" as const,
      pages: [
        {
          page: 1,
          status: "read" as const,
          title: null,
          lineItemCount: 0,
        },
      ],
      fields: [],
      lineItems: [],
      totals: {
        subtotal: null,
        gst: null,
        total: null,
      },
      refusals: [],
      warnings: [],
    };

    expect(() => ExtractionResult.parse(minimalResult)).not.toThrow();
  });

  it("rejects SourcedNumber with empty raw", () => {
    const invalidSourcedNumber = {
      value: 123,
      raw: "",
      evidence: {
        page: 1,
        sourceText: "some text",
      },
    };

    expect(() => SourcedNumber.parse(invalidSourcedNumber)).toThrow();
  });
});
