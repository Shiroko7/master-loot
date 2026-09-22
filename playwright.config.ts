import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  workers: 4,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5180",
    viewport: { width: 1280, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
    url: "http://127.0.0.1:5180/test/browser/newspaper.html",
    reuseExistingServer: !process.env.CI,
  },
});
