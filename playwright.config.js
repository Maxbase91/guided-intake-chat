// End-to-end tests: real index.html and api/llm.js behind scripts/dev-server.js, driven in Chromium.
// Three local servers: offline (no keys), AI (mock providers) and gated (mock providers + access code).
const { defineConfig, devices } = require("@playwright/test");

const PORTS = { offline: 4310, ai: 4311, gated: 4312 };
const server = (port, env = {}) => ({
  command: `node scripts/dev-server.js ${port}`,
  url: `http://localhost:${port}/api/llm`,
  reuseExistingServer: false,
  timeout: 20_000,
  env: { MOCK_PROVIDERS: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", OPENROUTER_API_KEY: "", ACCESS_CODE: "", ...env },
});
const mockKeys = { MOCK_PROVIDERS: "1", GEMINI_API_KEY: "mock", GROQ_API_KEY: "mock", MISTRAL_API_KEY: "mock" };

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/html" }]],
  outputDir: "test-results/artifacts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORTS.offline}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}),
  },
  webServer: [
    server(PORTS.offline),
    server(PORTS.ai, mockKeys),
    server(PORTS.gated, { ...mockKeys, ACCESS_CODE: "demo-code" }),
  ],
});
module.exports.PORTS = PORTS;
