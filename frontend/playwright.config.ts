import { defineConfig } from "@playwright/test";

// Keep the mandatory connected journey evidence separate from broad regressions.
const evidenceRoot = process.env.PLAYWRIGHT_EVIDENCE_SUBDIR === "connected"
  ? "outputs/ui-ux/connected" : "outputs/ui-ux";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  outputDir: `${evidenceRoot}/results`,
  reporter: [["list"], ["html", { outputFolder: `${evidenceRoot}/report`, open: "never" }],
    ["junit", { outputFile: `${evidenceRoot}/junit.xml` }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
