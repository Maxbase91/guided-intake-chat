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
  await page.click("[data-tab=categories]");
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
  await page.click("[data-tab=rules]");
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
  await page.click("[data-tab=versions]");
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
  await page.click("[data-tab=decisions]");
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
  await page.click("[data-tab=channels]");
  await page.fill("#c-business-name", '<img src=x onerror="window.__xss=1">');
  await page.click("#saveBtn");
  await expect(status(page)).toContainText("Draft differs");
  await page.reload();
  await page.click("[data-tab=channels]");
  await expect(page.locator("#c-business-name")).toHaveValue('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => [window.__xss, document.querySelectorAll("main img").length])).toEqual([undefined, 0]);
  accept(page);
  await page.click("#discardBtn");
  await expect(status(page)).toContainText("No changes");
});
