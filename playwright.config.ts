import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the installed browser, so there's no Playwright download step.
    channel: process.env.E2E_CHANNEL ?? "msedge",
  },
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
