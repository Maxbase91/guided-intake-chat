// Rules as data: the routing rules, thresholds and category flags are a configuration the page loads from the server
// (the published version in the database), with the built-in defaults as the fallback. Changing the configuration
// changes the outcome with no change to the code. Submitting stores the decision log, without anything the requester wrote.
const { test, expect } = require("@playwright/test");
const { openApp, start, answerUntilDone, lastAssistant, urlFor } = require("./helpers");

const DINNER = "An agency for a client dinner for 40 people, around 30k.";
const routeOf = (page, text = DINNER) => page.evaluate((t) => withExampleState(t, () => [S.det.route, S.det.lead && S.det.lead.row]), text);
// the configuration the test server publishes, changed as an admin would change it
async function published(request, change) {
  const cfg = await (await request.get(urlFor("offline").replace(/\/$/, "") + "/api/config")).json();
  change(cfg);
  return { ...cfg, version: 7, source: "database" };
}

test("without a database the server serves the seed, and the page runs on its built-in defaults", async ({ page }) => {
  const errors = await openApp(page);
  const got = await page.evaluate(() => ({ cfg: { ...CFG }, defaults: DEFAULTS.checksum, ref: DEFAULTS.ref_checksum, rules: Object.keys(RULES) }));
  expect(got.cfg).toEqual({ version: 0, source: "builtin", checksum: got.defaults, ref_checksum: got.ref });
  expect(got.rules).toEqual(["R01", "R02", "R11", "R19", "R07", "R08", ...Array.from({ length: 24 }, (_, i) => `R${20 + i}`)]);
  expect(await routeOf(page)).toEqual(["business", "division"]);
  await page.click("#howBtn");
  await expect(page.locator("#specPaper")).toContainText("Configuration in use: the built-in defaults");
  expect(errors).toEqual([]);
});

test("the request records the rule rows that decided and the configuration it ran on", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate((t) => withExampleState(t, () => S.det.rules), DINNER);
  expect(got).toEqual([{ rule: "R01", row: 3, outcome: "not_covered" }, { rule: "R02", row: 3, outcome: "not_covered" }, { rule: "R11", row: 6, outcome: "division" }, { rule: "R19", row: 3, outcome: "business" }, { rule: "R07", row: 2, outcome: "clear" }, { rule: "R08", row: 2, outcome: "clear" },
    // the review flags raised (rule cards that raise none are not recorded)
    { rule: "R23", row: 1, outcome: "flag" }, { rule: "R24", row: 1, outcome: "flag" }, { rule: "R33", row: 4, outcome: "clients" }, { rule: "R43", row: 1, outcome: "flag" }]);
});

test("a published configuration from the server replaces the defaults and changes the outcome", async ({ page, request }) => {
  const cfg = await published(request, (c) => { c.params.find((p) => p.key === "formMin").value = 20000; c.channels.find((x) => x.key === "procurement").name = "Procurement-led <b>demand</b>"; });
  await page.route("**/api/config", (r) => r.fulfill({ json: cfg }));
  const errors = await openApp(page);
  expect(await page.evaluate(() => [CFG.version, CFG.source, CONFIG.thresholds.formMin])).toEqual([7, "database", 20000]);
  expect(await routeOf(page)).toEqual(["procurement", "cm_decides"]);
  // a name from the configuration is shown as text, never as markup
  await start(page, DINNER);
  await expect(page.locator("#side .route")).toHaveText("Procurement-led <b>demand</b>");
  expect(await page.locator("#side .route b").count()).toBe(0);
  await page.click("#howBtn");
  await expect(page.locator("#specPaper")).toContainText("Configuration in use: version 7, published in the database");
  await expect(page.locator("#specPaper")).toContainText("€20,000");
  expect(errors).toEqual([]);
});

test("a changed rule row changes the outcome: marketing becomes a category the Category Manager must handle", async ({ page, request }) => {
  const cfg = await published(request, (c) => { c.params.find((p) => p.key === "formMin").value = 20000; c.categories.find((x) => x.id === "marketing").cm_mandatory = true; });
  await page.route("**/api/config", (r) => r.fulfill({ json: cfg }));
  await openApp(page);
  expect(await routeOf(page)).toEqual(["procurement", "cm_mandatory"]);
  // and a rule with its rows reordered: the division leads whatever the value
  const got = await page.evaluate((t) => { const c = structuredClone(DEFAULTS), r = c.rules.find((x) => x.id === "R11"); r.rows = [r.rows[r.rows.length - 1]]; applyConfig(c); const out = withExampleState(t, () => S.det.route); applyConfig(DEFAULTS); return out; },
    "KYC periodic reviews for our corporate clients by an external provider for 2 years, around 600k.");
  expect(got).toBe("business");
});

test("when the configuration cannot be loaded the page uses its last copy, and without one the built-in defaults", async ({ page, request }) => {
  const cfg = await published(request, (c) => { c.params.find((p) => p.key === "formMin").value = 20000; });
  let mode = "ok";
  await page.route("**/api/config", (r) => (mode === "ok" ? r.fulfill({ json: cfg }) : mode === "down" ? r.fulfill({ status: 503, json: { error: "The configuration could not be loaded.", code: "config_unavailable" } }) : r.abort()));
  mode = "down";
  const errors = await openApp(page);
  expect(await page.evaluate(() => [CFG.version, CFG.source])).toEqual([0, "builtin"]);
  mode = "ok"; await page.reload(); await page.waitForFunction(() => window.__ready === true);
  expect(await page.evaluate(() => [CFG.version, CFG.source])).toEqual([7, "database"]);
  mode = "abort"; await page.reload(); await page.waitForFunction(() => window.__ready === true);
  expect(await page.evaluate(() => [CFG.version, CFG.source, CONFIG.thresholds.formMin])).toEqual([7, "cached", 20000]);
  // something that is not a configuration is ignored
  await page.evaluate(() => localStorage.setItem("cfg", JSON.stringify({ params: "x" })));
  await page.reload(); await page.waitForFunction(() => window.__ready === true);
  expect(await page.evaluate(() => [CFG.version, CFG.source])).toEqual([0, "builtin"]);
  expect(errors.filter((e) => !/503|ERR_FAILED|Failed to fetch/.test(e))).toEqual([]);
});

test("submitting stores the decision log: rule rows and typed facts, nothing the requester wrote", async ({ page, request }) => {
  const errors = await openApp(page);
  await start(page, DINNER);
  await answerUntilDone(page, []);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/decisions")), page.click("[data-act=submit]")]);
  const body = resp.request().postDataJSON();
  expect(resp.status()).toBe(200);
  // the rows are stored: the same batch sent again stores nothing new
  expect(await (await request.post(resp.url(), { data: body })).json()).toEqual({ stored: 0 });
  expect(body.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect([body.config_version, body.config_source]).toEqual([0, "builtin"]);
  expect(body.decisions.map((d) => [d.seq, d.rule, d.outcome])).toEqual([[0, "R01", "not_covered"], [1, "R02", "not_covered"], [2, "R11", "division"], [3, "R19", "business"], [4, "R07", "clear"], [5, "R08", "clear"], [6, "R23", "flag"], [7, "R24", "flag"], [8, "R33", "clients"], [9, "R43", "flag"]]);
  expect(body.decisions[8].facts).toMatchObject({ route: "business", hospitality_guests: "clients", category_guessed: false, goods: false });
  expect(body.decisions[2].facts).toMatchObject({ category: "marketing", annual_value: 30000, total_value: 30000, value_known: true, cat_cm_mandatory: false, request_type: "new", r11: "division" });
  expect(JSON.stringify(body)).not.toMatch(/dinner|agency|40 people/i);
  await expect(lastAssistant(page)).toContainText("Only the record of which rules decided is stored");
  expect(errors).toEqual([]);
});
