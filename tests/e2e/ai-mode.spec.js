// AI mode: the page talks to the real api/llm.js, whose Gemini, Groq and Mistral calls are answered by scripts/mock-providers.js.
// The mock server is shared, so these tests run one after another and reset it first.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices, answerUntilDone, mock, downloadJSON, PORTS } = require("./helpers");

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
  // the requester names the data (the AI may only record what was said); the place comes from the question's example
  await say(page, "About 400k, and the provider will see employee names and salaries");
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
  await say(page, "About 400k, and the provider will see employee names and salaries");
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

test("'No, look wider' leaves the framework even when the AI records the answer as the text 'no' and names the framework's supplier", async ({ page, request }) => {
  const errors = await openApp(page, { kind: "ai" });
  // the case from a real run: three business consultants, the Lakeshore framework declined
  await say(page, "I need three business consultants for a target operating transformation in procurement for 9 months");
  for (let i = 0; i < 6 && (await page.evaluate(() => S.lastAsked)) !== "contract_ok"; i++) {
    const q = await lastAssistant(page).innerText();
    await say(page, /cost/i.test(q) ? "80k" : /When/i.test(q) ? "1 March 2027" : "A target operating model and a rollout plan");
  }
  expect(await page.evaluate(() => [S.det.route, S.det.contract && S.det.contract.supplier])).toEqual(["contract", "Lakeshore Advisory"]);
  await mock(request, { nextChat: { facts: { contract_ok: "no", supplier: "Lakeshore Advisory" } } });
  await choose(page, "No, look wider");
  const got = await page.evaluate(() => ({ route: S.det.route, contract: S.det.contract, supplier: S.f.supplier, declined: S.f.decline_contract }));
  expect(got.route).not.toBe("contract");
  expect(got.contract).toBeNull();
  expect(got.supplier).not.toBe("Lakeshore Advisory");
  expect(got.declined).toBe(true);
  await expect(page.locator("#side .route")).not.toContainText("Contract call-off");
  expect(errors).toEqual([]);
});

// from a live AI test (October 2026): the AI filled gaps with "unknown"/"none", invented facts and flags, overrode a clear category,
// saved line labels as an answer, and changed the budget in passing. The app now screens what the AI records.
test("the AI records only what was said: placeholders, invented details and flags are dropped", async ({ page, request }) => {
  const errors = await openApp(page, { kind: "ai" });
  await mock(request, { nextChat: { facts: { category: "marketing", demand_type: "services", supplier: "unknown", entity: "unknown", location: "unknown", impact_delay: "none",
    current_solution: "none", important_fn: true, in_house: false, budget_approved: "unsure", must_haves: "menu options, seating, decor", usp: "fancy menu and ambience",
    audience_fn: "Sponsor and stakeholders, Teams involved", users: "clients", item: "Dinner" } } });
  await say(page, "dinner for some clients in December, maybe 30 people. my boss wants it fancy lol");
  const got = await page.evaluate(() => ({ f: Object.fromEntries(["supplier", "entity", "location", "impact_delay", "current_solution", "important_fn", "budget_approved", "must_haves", "usp", "audience_fn", "users"].map((k) => [k, S.f[k]])),
    controls: S.det.controls.map((c) => c[1]), first: S.msgs.filter((m) => m.role === "assistant" && m.text).map((m) => m.text).join("\n") }));
  expect(got.f).toEqual({ supplier: null, entity: null, location: null, impact_delay: null, current_solution: null, important_fn: null, budget_approved: null,
    must_haves: null, usp: null, audience_fn: null, users: "clients" });
  expect(got.controls).not.toContain("Non-preferred supplier");
  expect(got.controls).not.toContain("Critical or important function check");
  expect(got.first).not.toMatch(/"none"/);
  expect(errors).toEqual([]);
});

test("a clear keyword category beats the AI's category on the first message (KYC is not legal)", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await mock(request, { nextChat: { facts: { category: "legal", demand_type: "services", l4: "L4-2201" } } });
  await say(page, "KYC periodic reviews for our corporate clients by an external provider for 2 years, around 600k");
  expect(await page.evaluate(() => [S.f.category, S.det.route, S.f.l4 === "L4-2201"])).toEqual(["bpo", "sourcing", false]);
});

test("a question back is answered by the AI, nothing is recorded, and the same question comes back with its buttons", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, "We need business consultants to redesign our procurement operating model, about 200k for 6-12 months");
  expect(await page.evaluate(() => S.lastAsked)).toBe("contract_ok");
  await mock(request, { nextChat: { answers_question: false, facts: {}, reply: "Lakeshore Advisory was selected for the operations consulting framework in a competitive tender. Would you like to use it?" } });
  await say(page, "are they even any good at procurement?");
  await expect(lastAssistant(page)).toContainText("selected for the operations consulting framework in a competitive tender");
  await expect(lastAssistant(page)).toContainText("Would you like to use it?");
  expect(await choices(page).allInnerTexts()).toEqual(["Yes, use it", "No, look wider"]);
  expect(await page.evaluate(() => [S.f.contract_ok, S.lastAsked])).toEqual([null, "contract_ok"]);
});

test("a budget the AI changes in passing is said out loud", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  await mock(request, { nextChat: { facts: { value: 450000, background: "Our payroll tool is end of life" } } });
  await say(page, "Our payroll tool is end of life, and we found another 50k");
  expect(await page.evaluate(() => S.msgs.map((m) => m.text || "").join("\n"))).toContain("Changed: budget from €400,000 to **€450,000**");
});

test("a suggestion the AI writes without its line labels is replaced, and its lead-in is not glued to the question", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  await mock(request, { nextChat: { asking: "audience_fn", suggestion: "Target audience – e.g. HR teams; Supported functions – e.g. Finance",
    reply: "Here's a quick template you could use: Target audience – e.g. Who uses it? My suggestion follows." } });
  await say(page, "Our payroll tool is end of life and payroll runs on spreadsheets; if delayed we miss the reporting deadline");
  const last = await lastAssistant(page).innerText();
  expect(last).toMatch(/Target audience: /);
  expect(last).toMatch(/Supported functions: /);
  expect(last).not.toMatch(/quick template|– e\.g\./);
});

test("an accepted AI suggestion for a question without its own is stored as given; a business answer is not 'off-topic'", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  // the AI calls a thin but relevant answer off-topic: the app treats it as an answer
  await mock(request, { nextChat: { assessment: { fact: "background", ok: false, issue: "off-topic", follow_up: "", score: 1 } } });
  await say(page, "too slow and expensive");
  expect(await lastAssistant(page).innerText()).not.toContain("doesn't seem to answer");
  for (let i = 0; i < 4 && (await page.evaluate(() => S.lastAsked)) !== "current_solution"; i++) {
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) await choose(page, "Use this suggestion"); else await say(page, "Payroll runs late every month and we miss the reporting deadline");
  }
  expect(await page.evaluate(() => S.lastAsked)).toBe("current_solution");
  await say(page, "what would you suggest?");
  await expect(lastAssistant(page)).toContainText("Here's a suggestion");
  const sg = await page.evaluate(() => S.adhoc && S.adhoc.sg);
  await say(page, "sounds good");
  expect(await page.evaluate(() => S.f.current_solution)).toBe(sg);
});

test("from the repeated live run: 'skip' is skipped, an accepted suggestion is not challenged, unasked facts need the requester's words, 'keep it' invents no date", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, HR);
  await say(page, "About 400k");
  await say(page, "Our payroll tool is end of life and payroll runs on spreadsheets; if delayed we miss the reporting deadline");
  expect(await page.evaluate(() => S.lastAsked)).toBe("audience_fn");
  // the AI calls "skip" not an answer: it is still a skip
  await mock(request, { nextChat: { answers_question: false, facts: {}, reply: "Got it, we'll skip that for now. Let's move on." } });
  await say(page, "skip");
  expect(await page.evaluate(() => [S.f.audience_fn, S.lastAsked !== "audience_fn"])).toEqual(["Not given", true]);
  for (let i = 0; i < 3 && (await page.evaluate(() => S.lastAsked)) !== "value_props"; i++) await say(page, "Spreadsheets and email; we have no team to build this");
  expect(await page.evaluate(() => S.lastAsked)).toBe("value_props");
  // "k" accepts the suggestion; the AI's check on it and a must-have built from the suggestion's words are ignored
  const sgWords = await page.evaluate(() => S.suggest.value_props.split(/\n/)[0].replace(/^[^:]+:\s*/, ""));
  await mock(request, { nextChat: { assessment: { fact: "value_props", ok: false, issue: "too vague", follow_up: "Please confirm or provide more details.", score: 3 }, facts: { must_haves: sgWords } } });
  await say(page, "k");
  expect(await page.evaluate(() => [S.sugAccepted.value_props, S.f.must_haves, S.lastAsked])).toEqual([true, null, "must_haves"]);
});

test("'it's fine, keep it' on a past start does not take a date the AI made up", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await say(page, "mid 26");
  await expect(lastAssistant(page)).toContainText("seems to be in the past");
  await mock(request, { nextChat: { facts: { needed_by: "mid 2027" } } });
  await say(page, "it's fine, keep it");
  expect(await page.evaluate(() => S.f.needed_by)).toBe("To be determined");
});
