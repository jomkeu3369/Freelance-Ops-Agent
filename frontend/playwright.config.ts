import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  outputDir: "outputs/ui-ux/results",
  reporter: [["list"], ["html", { outputFolder: "outputs/ui-ux/report", open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
