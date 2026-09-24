import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadForExtraction, type Outcome } from "./extract-client";

const file = new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" });

function respondWith(response: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))));
}

function failure(outcome: Outcome) {
  if (outcome.kind !== "failed") throw new Error(`expected a failure, got ${outcome.kind}`);
  expect(`${outcome.failure.title} ${outcome.failure.explanation}`).not.toMatch(/something went wrong|an error occurred/i);
  return outcome.failure;
}

afterEach(() => vi.unstubAllGlobals());

describe("uploadForExtraction never hides why something failed", () => {
  it("passes the server's own explanation through", async () => {
    respondWith(Response.json({ error: { code: "PDF_ENCRYPTED", message: '"invoice.pdf" is password-protected.' } }, { status: 422 }));
    const f = failure(await uploadForExtraction(file));
    expect(f.explanation).toBe('"invoice.pdf" is password-protected.');
    expect(f.code).toBe("PDF_ENCRYPTED");
  });

  it("explains Vercel's non-JSON 413 page as a size problem", async () => {
    respondWith(new Response("<html>Request Entity Too Large</html>", { status: 413 }));
    expect(failure(await uploadForExtraction(file)).title).toBe("This file is too large");
  });

  it("explains a timeout", async () => {
    respondWith(new Response("An error occurred", { status: 504 }));
    expect(failure(await uploadForExtraction(file)).title).toBe("Reading the file took too long");
  });

  it("explains a network failure", async () => {
    respondWith(new TypeError("Failed to fetch"));
    expect(failure(await uploadForExtraction(file)).title).toBe("Couldn't reach the server");
  });

  it("refuses to show a reply that doesn't match the contract", async () => {
    respondWith(Response.json({ outcome: "complete" }));
    expect(failure(await uploadForExtraction(file)).title).toBe("The server's reply was incomplete");
  });
});
