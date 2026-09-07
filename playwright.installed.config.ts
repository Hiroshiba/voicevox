import type { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
  testDir: "./tests/e2e/installed",
  timeout: 10 * 60 * 1000,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"]] : [["list"]],
  expect: {
    timeout: 60 * 1000,
  },
  use: {
    actionTimeout: 60 * 1000,
  },
};

export default config;
