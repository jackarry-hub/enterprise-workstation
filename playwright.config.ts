import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { authStatePath } from "./tests/e2e/auth-state";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: path.join(tmpdir(), "enterprise-workstation-playwright"),
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    channel: "chrome",
    storageState: authStatePath("executive"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "iphone-13", use: { ...devices["iPhone 13"], channel: "chrome" } },
    { name: "pixel-7", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "ipad-mini", use: { ...devices["iPad Mini"], channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
