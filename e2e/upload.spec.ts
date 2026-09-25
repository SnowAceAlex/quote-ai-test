import { expect, test, type Page } from "@playwright/test";

const GENERIC = /something went wrong|an error occurred|unexpected error/i;

// Next's route announcer is also role="alert", and the raw JSON panel repeats every string.
const failure = (page: Page) => page.getByTestId("upload-failure");
const shown = (page: Page, ...args: Parameters<Page["getByText"]>) => page.getByText(...args).filter({ visible: true });

async function openSample(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name }).click();
  await expect(shown(page, /^We (extracted|couldn't extract)/)).toBeVisible();
}

test.afterEach(async ({ page }) => {
  await expect(page.locator("body")).not.toContainText(GENERIC);
});

test.describe("samples", () => {
  test("IB-55871 shows a complete result with sources", async ({ page }) => {
    await openSample(page, "IB-55871");
    await expect(shown(page, "We extracted 4 line items. Every figure below shows where it came from.")).toBeVisible();
    await expect(shown(page, "What we couldn't extract")).toHaveCount(0);
    await page.getByRole("cell", { name: "Framing nail gun coil, 90mm galv" }).click();
    await expect(shown(page, "FX-201 Framing nail gun coil, 90mm galv 24 box $52.00 $1,248.00")).toBeVisible();
  });

  test("IB-55902 explains the scanned page instead of failing", async ({ page }) => {
    await openSample(page, "IB-55902");
    await expect(shown(page, "We couldn't extract any line items from this document. Here's why:")).toBeVisible();
    await expect(shown(page, /Page 1 is a scanned image with no readable text/)).toBeVisible();
    await expect(failure(page)).toHaveCount(0);
  });

  test("IB-56010 says what the document never states", async ({ page }) => {
    await openSample(page, "IB-56010");
    await expect(page.getByRole("heading", { name: "Line amounts and total" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Total weight" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "refused" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Other columns" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "640 g", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "whole line" })).toBeVisible();
    await expect(page.getByRole("link", { name: "not used" })).toHaveCount(3);
  });

  test("IB-56088 quotes both carton counts", async ({ page }) => {
    await openSample(page, "IB-56088");
    await expect(page.getByRole("heading", { name: "Number of cartons" })).toBeVisible();
    await expect(page.locator("article q", { hasText: "Summary: 9 cartons dispatched" })).toBeVisible();
    await expect(page.locator("article q", { hasText: "Warehouse notes: 11 cartons picked" })).toBeVisible();
  });

  test("IB-56150 shows the calculation behind the refused total", async ({ page }) => {
    await openSample(page, "IB-56150");
    await expect(shown(page, "$1,270.00 + $190.50 = $1,460.50", { exact: true })).toBeVisible();
    await expect(shown(page, "not reported")).toBeVisible();
  });

  test("IB-STMT47 marks the unreadable page and the pages to check", async ({ page }) => {
    await openSample(page, "IB-STMT47");
    await expect(shown(page, "Page 4: couldn't read")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Worth checking" })).toBeVisible();
    await expect(page.getByRole("link", { name: "check" })).toHaveCount(12);
  });
});

test.describe("failures reach the person in plain words", () => {
  test("a non-PDF is stopped before upload", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") });
    await expect(failure(page)).toContainText("This isn't a PDF");
  });

  test("a fake PDF is rejected by the server with its reason", async ({ page }) => {
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") });
    await expect(failure(page)).toContainText(`"notes.pdf" isn't a PDF file`);
    await expect(failure(page)).toContainText("HTTP 415 · NOT_A_PDF");
  });

  test("a network failure", async ({ page }) => {
    await page.route("**/api/extract", (route) => route.abort());
    await openSampleExpectingFailure(page);
    await expect(failure(page)).toContainText("Couldn't reach the server");
  });

  test("Vercel's own 413 page", async ({ page }) => {
    await page.route("**/api/extract", (route) =>
      route.fulfill({ status: 413, contentType: "text/html", body: "<h1>Request Entity Too Large</h1>" }),
    );
    await openSampleExpectingFailure(page);
    await expect(failure(page)).toContainText("This file is too large");
  });

  test("a reply that doesn't match the contract", async ({ page }) => {
    await page.route("**/api/extract", (route) => route.fulfill({ json: { outcome: "complete" } }));
    await openSampleExpectingFailure(page);
    await expect(failure(page)).toContainText("The server's reply was incomplete");
  });

  test("cancelling while the sample is still downloading", async ({ page }) => {
    await page.route("**/samples/*.pdf", () => new Promise(() => {}));
    await page.goto("/");
    await page.getByRole("button", { name: "IB-55871" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(failure(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "IB-55871" })).toBeEnabled();
  });

  test("cancelling returns to the start without an error", async ({ page }) => {
    await page.route("**/api/extract", () => new Promise(() => {}));
    await page.goto("/");
    await page.getByRole("button", { name: "IB-55871" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(failure(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "IB-55871" })).toBeEnabled();
  });
});

async function openSampleExpectingFailure(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "IB-55871" }).click();
}
