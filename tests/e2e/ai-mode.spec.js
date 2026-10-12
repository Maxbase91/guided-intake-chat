// AI mode: the page talks to the real api/llm.js, whose Gemini, Groq and Mistral calls are answered by scripts/mock-providers.js.
// The mock server is shared, so these tests run one after another and reset it first.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, answerUntilDone, mock, downloadJSON, PORTS } = require("./helpers");

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  await mock(request, { gemini: "ok", groq: "ok", mistral: "ok", coldStart: true, resetCalls: true, nextChat: null });
});

const HR = "A new HR system to replace our payroll tool.";
const ANSWERS = [
  [/cost in total/i, "About 400k"],
  [/business problem/i, "Our payroll tool is end of life in 2027 and payroll runs on manual spreadsheets; if delayed we miss the statutory reporting deadline"],
  [/use today/i, "Today an old on-premise payroll tool and spreadsheets; we have no team that could build a replacement"],
  [/must it be able to do/i, "Payroll for Germany and the UK, employee self-service and an audit trail; it works if 99.5% of payslips are correct in the first 3 months"],
  [/When (do you need it|should it start)/i, "Go live by 1 September 2027"],
  [/budget already approved/i, "Yes"],
  [/kind of data/i, "Employee names, salaries and bank details, stored in the EU"],
];
const calls = async (request) => (await mock(request, {})).calls;

test("with a server key the pill shows AI on and names the provider that answered", async ({ page, request }) => {
  const errors = await openApp(page, { kind: "ai" });
  await expect(page.locator("#aiLabel")).toHaveText("AI on");
  await expect(page.locator(".pill")).toHaveAttribute("title", /Fallback order: Gemini → Groq → Mistral/);
  await say(page, HR);
  await expect(page.locator("#aiLabel")).toHaveText("AI on · Gemini");
  await expect(lastAssistant(page)).toContainText("?");
  expect((await calls(request)).every((c) => c.provider === "gemini")).toBe(true);
  expect(errors).toEqual([]);
});

test("a full new-demand conversation runs on the AI and the documents are written by it", async ({ page, request }) => {
  const errors = await openApp(page, { kind: "ai" });
  await say(page, HR);
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("New demand: procurement-led sourcing");
  // the AI's description is used; the route still comes from the rules
  await expect(page.locator('.sd-h [data-sd="title"]')).toHaveText("Mock HR and payroll platform");
  await expect(page.locator(".sd .srq .cmp")).toContainText("managed HR and payroll platform");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("above the €50,000 threshold");
  const { data } = await downloadJSON(page, async () => { await page.locator("[data-act=more]").last().click(); await page.locator(".more [data-act=json]").last().click(); });
  expect(data.source).toBe("server");
  expect(data.decision.route).toBe("sourcing");
  expect((await calls(request)).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test("when Gemini is rate limited the server falls back to Groq and the pill says so", async ({ page, request }) => {
  await mock(request, { gemini: "429" });
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await expect(page.locator("#aiLabel")).toHaveText("AI on · Groq");
  const providers = (await calls(request)).map((c) => c.provider);
  expect(providers.slice(0, 3)).toEqual(["gemini", "gemini", "groq"]);
});

test("when every provider is down the chat carries on with standard questions", async ({ page, request }) => {
  await mock(request, { gemini: "500", groq: "500", mistral: "500" });
  const errors = await openApp(page, { kind: "ai" });
  await say(page, HR);
  await expect(page.locator("#msgs")).toContainText("using standard questions");
  await expect(lastAssistant(page)).toContainText("Roughly what will this cost in total?");
  await say(page, "About 400k");
  await expect(page.locator("#side .route")).toHaveText("New demand: procurement-led sourcing");
  expect(errors).toEqual([]);
});

test("internal field names in an AI reply never reach the user", async ({ page }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k MOCK_LEAK");
  const text = await page.locator("#msgs").innerText();
  expect(text).not.toMatch(/ict_outsourcing|personal_data|facts JSON|\btrue\b/);
});

test("an answer the AI flags as off-topic is asked again", async ({ page }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  await say(page, "MOCK_OFFTOPIC the weather is lovely today");
  await expect(lastAssistant(page)).toContainText(/doesn't seem to answer|business problem/);
});

test("an off-topic verdict on a question that was not asked is ignored", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await mock(request, { nextChat: { assessment: { fact: "system_access", ok: false, issue: "off-topic", follow_up: "", score: 1 } } });
  await say(page, "About 400k");
  await expect(page.locator("#msgs")).not.toContainText("doesn't seem to answer");
  await expect(page.locator("#msgs")).not.toContainText("Answer quality");
});

test("a storage location the AI adds on its own is asked about, and dropped if the requester doesn't know", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  // as in a real run: the requester names the data only, the AI copies the question's example "stored in the EU"
  await mock(request, { nextChat: { facts: { personal_data: true, data_details: "employee names and salaries; stored in the EU" } } });
  await say(page, "About 400k");
  await expect(lastAssistant(page)).toContainText("where will that data (employee names and salaries) be stored");
  await say(page, "Not sure");
  expect(await page.evaluate(() => S.f.data_details)).toBe("employee names and salaries");
});

test("turning the AI off under Rules switches to offline questions without reloading", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await page.click("#cfgBtn");
  await expect(page.locator(".drawer")).toContainText("Connected through the server: Gemini, then Groq, then Mistral as backup");
  await page.uncheck("#aiToggle");
  await expect(page.locator(".drawer")).toContainText("Nothing leaves the browser");
  await page.click("#close");
  await expect(page.locator("#aiLabel")).toHaveText("Offline rules");
  await say(page, HR);
  expect(await calls(request)).toEqual([]);
});

test("?ai=mistral forces one provider for testing", async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-12T09:00:00Z") });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${PORTS.ai}/?ai=mistral`);
  await say(page, HR);
  await expect(page.locator("#aiLabel")).toHaveText("AI on · Mistral");
  expect([...new Set((await calls(request)).map((c) => c.provider))]).toEqual(["mistral"]);
});

test("an amount the AI returns as text ('€400k') is read as 400,000", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await mock(request, { nextChat: { facts: { value: "€400k", value_is_estimate: false } } });
  await say(page, "A new HR system to replace our payroll tool.");
  await expect(page.locator("#side .route")).toHaveText("New demand: procurement-led sourcing", { timeout: 2000 });
});

test("a place in the answer about where data is stored does not become the work location", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await mock(request, { nextChat: { facts: { personal_data: true, data_details: "employee names and salaries" } } });
  await say(page, "About 400k");
  await expect(lastAssistant(page)).toContainText("where will that data");
  // as in a live run: the AI also took "in the EU" as the location of the work
  await mock(request, { nextChat: { facts: { location: "EU" } } });
  await say(page, "in the EU");
  expect(await page.evaluate(() => [S.f.data_details, S.f.location])).toEqual(["employee names and salaries, stored in the EU", null]);
});

test("a second off-topic answer is recorded as not given when the AI flags it again", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  await say(page, "MOCK_OFFTOPIC we need a beer every Thursday");
  await expect(lastAssistant(page)).toContainText("doesn't seem to answer");
  const k = await page.evaluate(() => S.pending && S.pending.fact);
  // "team" makes it look like business text to the rules; the AI's verdict on the pending item decides
  await mock(request, { nextChat: { assessment: { fact: k, ok: false, issue: "off-topic", follow_up: "", score: 1 } } });
  await say(page, "pitch golf with the management team");
  expect(await page.evaluate((key) => S.f[key], k)).toBe("Not given");
});
