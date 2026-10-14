import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/live-browser",
  fullyParallel: false,
  workers: 1,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  outputDir: "outputs/live-workflow/results",
  reporter: [["list"], ["junit", { outputFile: "outputs/live-workflow/junit.xml" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:18220",
    channel: "chrome", headless: true,
    // Auth responses contain ephemeral tokens; retain only sanitized evidence.
    trace: "off", video: "off", screenshot: "only-on-failure",
  },
});
