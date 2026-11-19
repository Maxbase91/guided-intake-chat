// The admin page: procurement changes a threshold, a category flag or a rule row, publishes, and new conversations
// decide differently, with no change to the code. These tests share one server (port 4313) whose configuration they
// publish to, so they run in order and each builds on the one before.
const { test, expect } = require("@playwright/test");
const { openApp, start, answerUntilDone, urlFor } = require("./helpers");

const ADMIN = urlFor("admin") + "admin.html";
const DINNER = "An agency for a client dinner for 40 people, around 30k.";
const routeOf = (page) => page.evaluate((t) => withExampleState(t, () => [S.det.route, S.det.lead && S.det.lead.row, CFG.version, CFG.source]), DINNER);

async function signIn(page, { url = ADMIN, code = "admin-test", name = "Test Admin" } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  await page.fill("#code", code);
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  return errors;
}
// the publish and confirm dialogs: accept, with a note for the version list
const accept = (page, note = "") => page.once("dialog", (d) => d.accept(note));
const status = (page) => page.locator("#statusbar");
// the page has areas, each with sections: open("routing/thresholds"); advanced: true switches on the full rule editor
async function open(page, where, { advanced = false } = {}) {
  const [area, section] = where.split("/");
  await page.click(`[data-area=${area}]`);
  if (section) await page.click(`[data-section="${where}"]`);
  if (advanced && !(await page.isChecked("#advanced"))) await page.check("#advanced");
}

test.describe.configure({ mode: "serial" });

test("the admin page is closed without ADMIN_CODE, and a wrong code is refused", async ({ page }) => {
  await signIn(page, { url: urlFor("offline") + "admin.html" });
  await expect(page.locator(".err")).toContainText("ADMIN_CODE is missing");
  await signIn(page, { code: "guess" });
  await expect(page.locator(".err")).toHaveText("Wrong admin code.");
  await expect(page.locator("#statusbar")).toHaveCount(0);
});

test("a lower threshold is saved as a draft, published, and new conversations decide differently", async ({ page }) => {
  const errors = await openApp(page, { kind: "admin" });
  expect(await routeOf(page)).toEqual(["business", "division", 0, "builtin"]);

  errors.push(...(await signIn(page)));
  await expect(status(page)).toContainText("Published: version 0");
  await expect(status(page)).toContainText("All rules pass their tests");
  await expect(page.locator("#publishBtn")).toBeDisabled();

  await open(page, "routing/thresholds");
  await page.fill("#p-formMin", "20000");
  await expect(status(page)).toContainText("Unsaved changes");
  await expect(page.locator("#publishBtn")).toBeDisabled();   // save first
  // the rule's own test cases follow the threshold, so they still pass
  await expect(status(page)).toContainText("All rules pass their tests");
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("Draft differs from the published version");

  // the draft is not live yet
  const other = await page.context().newPage();
  await openApp(other, { kind: "admin" });
  expect(await routeOf(other)).toEqual(["business", "division", 0, "builtin"]);

  accept(page, "Sourcing request form from 20k");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 1");
  await expect(status(page)).toContainText("No changes");

  await other.reload(); await other.waitForFunction(() => window.__ready === true);
  expect(await routeOf(other)).toEqual(["procurement", "cm_decides", 1, "database"]);
  await other.click("#howBtn");
  await expect(other.locator("#specPaper")).toContainText("Configuration in use: version 1, published in the database");
  expect(errors).toEqual([]);
});

test("a category flag changes who leads", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "routing/categories");
  await page.check("#cat-marketing-cm_mandatory");
  await page.click("#saveBtn");
  accept(page, "Marketing is a mandatory category");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 2");
  await openApp(page, { kind: "admin" });
  expect(await routeOf(page)).toEqual(["procurement", "cm_mandatory", 2, "database"]);
  expect(errors).toEqual([]);
});

test("a rule that fails its own test cases shows why and cannot be published", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "routing/rules", { advanced: true });
  const r11 = page.locator("[data-rule=R11]");
  await expect(r11.locator(".row")).toHaveCount(6);
  await expect(r11.locator("summary").filter({ hasText: "Test cases" })).toContainText("9 of 9 pass");
  // the rows read as sentences
  await expect(r11.locator('[data-row="3"]')).toContainText("IF");
  await expect(r11.locator('[data-row="3"] select[aria-label="fact"]')).toHaveValue("annual_value");
  await expect(r11.locator('[data-row="3"] select[aria-label="comparison"]')).toHaveValue("gte");
  await expect(r11.locator('[data-row="3"] select[aria-label="compare with"]')).toHaveValue("p:leadMin");
  await expect(r11.locator('[data-row="6"]')).toContainText("OTHERWISE");

  // delete "procurement leads from the upper threshold"
  accept(page);
  await r11.getByRole("button", { name: "Delete row 3" }).click();
  await expect(r11.locator(".row")).toHaveCount(5);
  await expect(status(page)).toContainText("1 problem");
  await expect(page.locator("#problems")).toContainText('R11: test "At the upper threshold" expects lead_threshold, got cm_decides');
  await expect(r11.locator('[data-test="At the upper threshold"]')).toContainText("✗ gives: The Category Manager decides");
  await page.click("#saveBtn");                                // work in progress can be saved
  await expect(status(page)).toContainText("Draft differs from the published version");
  await expect(page.locator("#publishBtn")).toBeDisabled();    // but not published

  // moving a row changes the order in which the rows are checked
  await r11.getByRole("button", { name: "Move row 4 up" }).click();
  await expect(r11.locator('[data-row="3"] select[aria-label^="Outcome"]')).toHaveValue("cm_decides");
  await expect(status(page)).toContainText("problems");

  accept(page);
  await page.click("#discardBtn");
  await expect(status(page)).toContainText("No changes");
  await expect(status(page)).toContainText("All rules pass their tests");
  await expect(page.locator("[data-rule=R11] .row")).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("versions are kept, the change log says who changed what, and an earlier version can be published again", async ({ page }) => {
  const errors = await signIn(page, { name: "Second Admin" });
  await open(page, "history/versions");
  const cards = page.locator(".card");
  await expect(cards.first()).toContainText("Marketing is a mandatory category");
  await expect(cards.first()).toContainText("Sourcing request form from 20k");
  await expect(cards.nth(1)).toContainText("params: formMin");
  await expect(cards.nth(1)).toContainText("value: 100000 → 20000");
  await expect(cards.nth(1)).toContainText("categories: marketing");
  await expect(cards.nth(1)).toContainText("Test Admin");

  accept(page);
  await page.getByRole("button", { name: "Load into draft" }).click();   // version 1: the threshold change without the category flag
  await expect(status(page)).toContainText("Draft differs from the published version");
  accept(page, "Back to version 1");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 3");
  await openApp(page, { kind: "admin" });
  expect(await routeOf(page)).toEqual(["procurement", "cm_decides", 3, "database"]);
  expect(errors).toEqual([]);
});

test("a submitted request shows in the decision log with the version it ran on, and without the requester's words", async ({ page }) => {
  const errors = await openApp(page, { kind: "admin" });
  await start(page, DINNER);
  await answerUntilDone(page, []);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/decisions")), page.click("[data-act=submit]")]);
  errors.push(...(await signIn(page)));
  await open(page, "history/decisions");
  const cards = page.locator(".card");
  await expect(cards.first()).toContainText("R11");
  await expect(cards.first()).toContainText("The Category Manager decides");
  await expect(cards.nth(1)).toContainText("3 (database)");
  await expect(cards.nth(1)).toContainText("annual_value=30,000");
  await expect(cards.nth(1)).toContainText("category=marketing");
  expect(await page.locator("main").innerText()).not.toMatch(/dinner|agency|40 people/i);
  expect(errors).toEqual([]);
});

test("the admin page loads no inline script and builds its content as text", async ({ page }) => {
  await signIn(page);
  expect(await page.evaluate(() => [...document.scripts].filter((s) => !s.src).length)).toBe(0);
  await open(page, "routing/channels");
  await page.fill("#c-business-name", '<img src=x onerror="window.__xss=1">');
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("Draft differs");
  await page.reload();
  await open(page, "routing/channels");
  await expect(page.locator("#c-business-name")).toHaveValue('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => [window.__xss, document.querySelectorAll("main img").length])).toEqual([undefined, 0]);
  accept(page);
  await page.click("#discardBtn");
  await expect(status(page)).toContainText("No changes");
});

test("guidance and question texts are edited on the admin page, and new conversations use them", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "conversation/guidance");
  await page.selectOption("#gKey", "audience");
  await page.fill("#g-audience-marketing", "our top 40 corporate clients and their relationship managers");
  await open(page, "conversation/questions");
  await page.fill("#qFilter", "background");
  await expect(page.locator("[data-q=item]")).toHaveCount(0);
  await page.fill("#q-background-q", "Which client problem does this event solve, and what if it slips?");
  await page.click("#saveBtn");
  accept(page, "Guidance for client events");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 4");
  await open(page, "history/versions");
  await expect(page.locator(".card").nth(1)).toContainText("guidance: audience");
  await expect(page.locator(".card").nth(1)).toContainText("texts.marketing:");
  await openApp(page, { kind: "admin" });
  expect(await page.evaluate(() => [CFG.version, CAT_AUD.marketing, FACTS.background.q(S.f)])).toEqual([4, "our top 40 corporate clients and their relationship managers", "Which client problem does this event solve, and what if it slips?"]);
  expect(errors).toEqual([]);
});

test("divisions, review lists and which division is asked what are edited on the admin page", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "checks/lists");
  const list = page.locator("[data-list=prohibited_services]");
  await list.getByRole("button", { name: "+ entry" }).click();
  await expect(status(page)).toContainText("problem");           // an entry without search words cannot be published
  await list.locator("tbody tr").last().locator('input[aria-label="Name"]').fill("fortune telling");
  await list.locator("tbody tr").last().locator('input[aria-label^="Search words"]').fill("astrolog*, fortune tell*");
  await open(page, "checks/divisions");
  await page.fill("#d-private-office", "Private banking sourcing desk");
  await open(page, "conversation/questions");
  await page.fill("#qFilter", "spend");
  await page.selectOption("#qa-spend_type-private", "R");
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("All rules pass their tests");
  accept(page, "Lists and divisions");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 5");
  await openApp(page, { kind: "admin" });
  const got = await page.evaluate(() => withExampleState("An astrologer for our private clients event, around 30k.", () => {
    S.f.division = "private"; refresh();
    return { controls: S.det.controls.map((c) => c[2]).filter((t) => /fortune/.test(t)), asked: S.req.filter((k) => ["division", "demand_owner", "sponsor", "spend_type"].includes(k)) };
  }));
  expect(got.controls).toEqual(["This looks like fortune telling, which the bank does not buy from third parties. The Private banking sourcing desk and Compliance review it before anything else happens."]);
  expect(got.asked).toEqual(["division", "demand_owner", "sponsor", "spend_type"]);
  expect(errors).toEqual([]);
});

test("reference data: a contracts CSV is downloaded, edited, uploaded and published, and a request then uses the new contract", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "reference/contracts");
  const card = page.locator("[data-ref=contracts]");
  await expect(card).toContainText("40 entries");
  const [dl] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download CSV" }).click()]);
  const csv = require("fs").readFileSync(await dl.path(), "utf8");
  expect(csv.split("\n")[0]).toBe("id,supplier,title,l4,expires,remaining");
  expect(csv.split("\n").filter(Boolean).length).toBe(41);

  // a file with a wrong header is refused before anything changes
  await page.setInputFiles("#ref-contracts-file", { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("id,name\nX,Y\n") });
  await expect(card).toContainText("bad.csv: The first row must name the columns");
  await expect(status(page)).toContainText("No changes");

  // a contract for events, and one that points to a Level 4 that does not exist
  const edited = csv + 'CTR-9001,Gala Events,"Events and hospitality framework, Europe",L4-2301,2029-12-31,500000\nCTR-9002,Nobody,Broken,L4-9999,2029-12-31,1\n';
  await page.setInputFiles("#ref-contracts-file", { name: "contracts.csv", mimeType: "text/csv", buffer: Buffer.from(edited) });
  await expect(card).toContainText("42 entries");
  await expect(card).toContainText("contracts.csv: 42 entries loaded into the draft");
  await page.click("#saveBtn");
  await expect(page.locator("#problems")).toContainText("Contract CTR-9002: covers L4-9999, which is not in the Level 4 list");
  await expect(page.locator("#publishBtn")).toBeDisabled();

  // fixed in the file, uploaded again, published
  await page.setInputFiles("#ref-contracts-file", { name: "contracts.csv", mimeType: "text/csv", buffer: Buffer.from(edited.replace(/CTR-9002.*\n/, "")) });
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("All rules pass their tests");
  accept(page, "Events framework added");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 6");
  await open(page, "history/versions");
  await expect(page.locator(".card").nth(1)).toContainText("contracts: CTR-9001");

  await openApp(page, { kind: "admin" });
  const got = await page.evaluate(() => withExampleState("An agency for a client dinner for 40 people, around 30k.", () => { S.f.l4 = "L4-2301"; refresh(); return [S.det.route, S.det.contract && S.det.contract.id, TAXONOMY.version, CONTRACTS.length]; }));
  expect(got).toEqual(["contract", "CTR-9001", "configuration version 6", 41]);
  expect(errors).toEqual([]);
});

test("category search words are edited on the admin page and change which category a request lands in", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "reference/words");
  const kw = page.locator("#cat-marketing-kw");
  await kw.fill((await kw.inputValue()) + ", gala dinner*");
  await page.click("#saveBtn");
  accept(page, "Search word for gala dinners");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 7");
  await openApp(page, { kind: "admin" });
  expect(await page.evaluate(() => CATEGORIES.find((c) => c.id === "marketing").kw.includes("gala dinner*"))).toBe(true);
  // the reference data stays as published in version 6: the page received it only because it differs from its own
  expect(await page.evaluate(() => [CFG.version, CONTRACTS.some((c) => c.id === "CTR-9001")])).toEqual([7, true]);
  expect(errors).toEqual([]);
});

test("a review flag is a rule card: its title, level, reviewer and text are edited, and new conversations show them", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "checks/flags");
  await page.selectOption("#ruleStep", "Category checks");
  await expect(page.locator("[data-rule]")).toHaveCount(6);       // R31 to R36
  await page.fill("#fl-R33-clients-title", "Client hospitality approval");
  await page.selectOption("#fl-R33-clients-level", "w");
  await page.fill("#fl-R33-clients-owner", "Compliance desk");
  await page.locator("#rule-R33").getByLabel("Reason text of row 4").fill("Client hospitality: Compliance approves the guest list and the cost per guest.");
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("All rules pass their tests");
  accept(page, "Client hospitality reviewed by Compliance");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 8");
  await openApp(page, { kind: "admin" });
  const got = await page.evaluate((t) => withExampleState(t, () => S.det.controls.find((c) => /hospitality/i.test(c[1]))), DINNER);
  expect(got.slice(0, 5)).toEqual(["w", "Client hospitality approval", "Client hospitality: Compliance approves the guest list and the cost per guest.", "Compliance desk", false]);
  expect(got[5]).toBe("Gifts and entertainment policy; anti-bribery policy");   // what it rests on travels with the flag
  expect(errors).toEqual([]);
});

test("next steps, a word limit, answer buttons, an entity, a domain and a welcome example are edited and published", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "routing/channels");
  await page.fill("#ns-procurement-1", "A buyer contacts you within 1 working day to plan the RFP.");
  await page.fill("#ns-business-0", "You ask at least 3 suppliers for a quote{preferred}{nonsense}.");
  await page.click("#saveBtn");
  await expect(page.locator(".problems")).toContainText("{nonsense}");      // a placeholder this step does not fill is refused
  await page.fill("#ns-business-0", "You ask at least 4 suppliers for a quote{preferred}, using the service description.");
  await open(page, "conversation/quality");
  await page.fill("#p-headMax", "60");
  await open(page, "conversation/questions");
  await page.fill("#qFilter", "pay");
  await page.fill("#q-pricing_model-choices", "Fixed price\nPer milestone\nNot sure");
  await open(page, "checks/entities");
  await page.fill("#en-EU-keywords", (await page.inputValue("#en-EU-keywords")) + ", lisbon");
  await open(page, "conversation/examples");
  await page.fill("#ex-0", "A new HR system to replace our payroll tool, about 700k.");
  await open(page, "conversation/domains");
  await page.selectOption("#dKey", "voice");
  await page.fill("#dm-voice-keywords", (await page.inputValue("#dm-voice-keywords")) + ", dictaphone");
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("All rules pass their tests");
  accept(page, "Texts, limits and lists");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 9");
  await openApp(page, { kind: "admin" });
  const got = await page.evaluate(() => ({
    proc: withExampleState("A new HR system to replace our payroll tool, about 800k.", () => S.det.steps[1]),
    biz: withExampleState("Translation of our annual report, around 12k.", () => [S.det.steps[0], execLimits().head]),   // under the 20k form threshold of version 1; the dinner is a call-off since version 6
    choices: FACTS.pricing_model.choices, lisbon: (ENTITIES.find((e) => e.re.test("our Lisbon office")) || {}).id,
    voice: withExampleState("Dictaphones for our trading floor, about 20k.", () => (bankDomain(S.f) || {}).id), first: TRIES[0][2] }));
  expect(got).toEqual({ proc: "A buyer contacts you within 1 working day to plan the RFP.", biz: ["You ask at least 4 suppliers for a quote, ideally including Coho Creative and Polyglot Language Partners, using the service description.", 60],
    choices: ["Fixed price", "Per milestone", "Not sure"], lisbon: "EU", voice: "voice", first: "A new HR system to replace our payroll tool, about 700k." });
  await expect(page.locator("[data-try]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the overview shows five areas, which have changes and problems, and its links open the right place", async ({ page }) => {
  const errors = await signIn(page);
  await expect(page.locator("[data-overview]")).toHaveCount(5);
  await expect(page.locator("[data-overview=routing]")).toContainText("No changes");
  await page.getByRole("button", { name: "Change the next steps" }).click();
  await expect(page.locator('[data-section="routing/channels"]')).toHaveAttribute("aria-current", "page");
  await page.fill("#ns-procurement-0", "Submit. A sourcing project is created.");
  await expect(page.locator('[data-section="routing/channels"] .dot')).toHaveCount(1);   // unsaved: marked at once
  await page.click("#saveBtn");
  await open(page, "overview");
  await expect(page.locator("[data-overview=routing]")).toContainText("1 section changed, not yet published");
  await expect(page.locator("[data-overview=checks]")).toContainText("No changes");
  // a problem names its place and links to it
  await open(page, "checks/divisions");
  await page.fill("#d-corporate-office", "");
  await open(page, "overview");
  await expect(page.locator("[data-overview=checks]")).toContainText("1 problem");
  await page.locator("#problems").getByRole("button", { name: "Go to Checks and reviews › Divisions and vendor offices" }).click();
  await expect(page.locator('[data-section="checks/divisions"]')).toHaveAttribute("aria-current", "page");
  accept(page);
  await page.click("#discardBtn");
  await expect(status(page)).toContainText("No changes");
  expect(errors).toEqual([]);
});

test("simple view: a rule as sentences with its texts; advanced view: the full editor and the test cases; the switch is remembered", async ({ page }) => {
  const errors = await signIn(page);
  await open(page, "routing/rules");
  const r11 = page.locator("[data-rule=R11]");
  await expect(r11.locator('[data-row="3"]')).toContainText("When annual value (EUR) is at least Procurement leads from (500,000)");
  await expect(r11.locator('[data-row="6"]')).toContainText("Otherwise");
  await expect(r11.locator('select[aria-label="fact"]')).toHaveCount(0);
  await expect(r11.locator("[data-tests=R11]")).toContainText("All 9 test cases pass");
  await expect(r11.getByLabel("Reason text of row 3")).toBeVisible();
  // the rarely changed limits only with advanced settings
  await open(page, "conversation/quality");
  await expect(page.locator("#p-headMax")).toBeVisible();
  await expect(page.locator("#p-qualityWarn")).toHaveCount(0);
  await page.check("#advanced");
  await expect(page.locator("#p-qualityWarn")).toBeVisible();
  await page.reload();
  await expect(page.locator("#advanced")).toBeChecked();
  await expect(page.locator('[data-section="conversation/quality"]')).toHaveAttribute("aria-current", "page");   // the address keeps the place
  await open(page, "routing/rules");
  await expect(page.locator('[data-rule=R11] [data-row="3"] select[aria-label="fact"]')).toHaveValue("annual_value");
  await expect(page.locator("[data-rule=R11] details summary", { hasText: "Test cases" })).toHaveText("Test cases: 9 of 9 pass");   // collapsed while all pass
  expect(errors).toEqual([]);
});

test("search finds a setting by its name or text and opens it, switching on advanced settings when needed", async ({ page }) => {
  const errors = await signIn(page);
  await page.fill("#search", "day rate tolerance");
  await expect(page.locator(".result")).toHaveCount(0);
  await page.fill("#search", "differ day rate");
  await page.locator(".result", { hasText: "External workers: total may differ" }).click();
  await expect(page.locator('[data-section="conversation/quality"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#advanced")).toBeChecked();
  await expect(page.locator("#p-checkRateTolerance")).toBeFocused();
  await page.fill("#search", "R33");
  await page.locator(".result").first().click();
  await expect(page.locator('[data-section="checks/flags"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#rule-R33")).toBeInViewport();
  await page.fill("#search", "dictaphone");                     // a search word added in version 9
  await page.locator(".result", { hasText: "Domain:" }).click();
  await expect(page.locator("#dm-voice-name")).toBeFocused();
  expect(errors).toEqual([]);
});

test("the admin page fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await signIn(page);
  for (const where of ["overview", "checks/flags", "conversation/questions", "reference/contracts"]) {
    await open(page, where);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), where).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test("what a rule rests on reaches the route card once published, and the draft can be tried in the chat first", async ({ page, context }) => {
  const errors = await signIn(page);
  await open(page, "checks/flags");
  await page.locator("#rule-R23 details summary", { hasText: "Name, purpose and policy" }).click();
  await page.locator("#rule-R23").getByLabel(/Rests on/).fill("Purchasing standard 4.2: three quotes");
  await page.click("#saveBtn");
  // the chat on the draft, before publishing: a new tab with a banner; nothing is stored
  const [tab] = await Promise.all([context.waitForEvent("page"), page.click("#previewBtn")]);
  await tab.waitForLoadState();
  await expect(tab.locator(".preview-bar")).toBeVisible();
  const draft = await tab.evaluate(() => withExampleState("Translation of our annual report, around 12k.", () => [CFG.source, S.det.controls.find((c) => c[1] === "Three quotes")[5]]));
  expect(draft).toEqual(["preview", "Purchasing standard 4.2: three quotes"]);
  expect(await tab.evaluate(() => sendDecisions())).toBe(false);
  await tab.close();
  accept(page, "Quotes rest on the purchasing standard");
  await page.click("#publishBtn");
  await expect(status(page)).toContainText("Published: version 10");
  await openApp(page, { kind: "admin" });
  expect(await page.evaluate(() => withExampleState("Translation of our annual report, around 12k.", () => [CFG.source, S.det.controls.find((c) => c[1] === "Three quotes")[5]])))
    .toEqual(["database", "Purchasing standard 4.2: three quotes"]);
  expect(errors).toEqual([]);
});

test("every section says what it changes in the chat; rules say what they read; questions say what they decide; no empty guidance", async ({ page }) => {
  const errors = await signIn(page);
  for (const where of ["routing/thresholds", "routing/channels", "routing/rules", "checks/flags", "checks/lists", "conversation/questions", "conversation/guidance", "conversation/domains", "reference/contracts"]) {
    await open(page, where);
    await expect(page.locator(`[data-effect="${where}"]`)).toContainText("What this changes in the chat:");
  }
  await open(page, "checks/flags");
  await expect(page.locator("[data-reads=R26]")).toContainText("The provider will see personal or client data");
  await expect(page.locator("[data-reads=R26]")).toContainText("from the question on data and system access");
  await expect(page.locator("[data-rule] .reads")).toHaveCount(26);
  await open(page, "conversation/questions");
  await expect(page.locator("[data-usedby=personal_data]")).toContainText("Decides: R26, R30");
  await expect(page.locator("[data-usedby=evaluation_priority]")).toContainText("Recorded");
  await expect(page.locator("#q-tech_service-ex")).toHaveCount(0);            // no empty example box
  await open(page, "conversation/guidance");
  for (const key of ["deliverables_example", "audience_question", "project_kpis", "qualifications_question", "out_of_scope"]) {
    await page.selectOption("#gKey", key);
    const boxes = page.locator('textarea[id^="g-"]');
    const values = await boxes.evaluateAll((els) => els.map((e) => e.value.trim()));
    expect(values.filter((v) => !v), key).toEqual([]);
  }
  await open(page, "routing/rules");
  await expect(page.locator("text=Mode")).toHaveCount(0);
  expect(errors).toEqual([]);
});
