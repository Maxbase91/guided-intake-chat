// Small purchases (October 2026): "Flowers for a colleague's farewell, about 80 euros" asked 14 service-description questions.
// Now: punch-out shops in the catalogue, and a low-value path up to €5,000 that asks only the essentials.
const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { openApp, say, choose, lastAssistant } = require("./helpers");

const LONG_PATH = /business problem|What exactly must the provider do|not part of the|floor space|legal entity|Please check what I've worked out/i;

// answers each question with a fixed reply (or the first button) and returns the questions asked
async function answerAll(page, replies = {}) {
  const asked = [];
  for (let i = 0; i < 15; i++) {
    const k = await page.evaluate(() => S.lastAsked);
    if (!k) break;
    asked.push(k);
    const text = await lastAssistant(page).innerText();
    expect(text).not.toMatch(LONG_PATH);
    if (replies[k]) await say(page, replies[k]);
    else {
      const chips = await page.locator("#qr button").allInnerTexts();
      if (chips.length) await choose(page, chips[0]); else await say(page, "skip");
    }
  }
  return asked;
}

test("flowers for a farewell go to the florist shop with two questions and a short purchase request", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "Flowers for a colleague's farewell, about 80 euros");
  await expect(lastAssistant(page)).toContainText("florist shop of Petal & Stem Florists");
  const asked = await answerAll(page, { needed_by: "next Friday", location: "our Frankfurt office" });
  expect(asked).toEqual(["needed_by", "location"]);
  const got = await page.evaluate(() => ({ route: S.det.route, l4: S.f.l4, controls: S.det.controls.map((c) => c[1]) }));
  expect(got).toEqual({ route: "catalogue", l4: "L4-2537", controls: [] });
  await expect(page.locator(".sd .sd-h")).toContainText("Purchase request");
  await expect(page.locator(".sd [data-act=brd]")).toHaveCount(0);
  await expect(page.locator(".rec-h h2")).toHaveText("Catalogue order");
  expect(errors).toEqual([]);
});

test("'I want to buy flowers' asks the order value first, and a big flower contract is new demand", async ({ page }) => {
  await openApp(page);
  await say(page, "I want to buy flowers");
  expect(await page.evaluate(() => [S.det.route, S.lastAsked])).toEqual(["catalogue", "value"]);
  await expect(lastAssistant(page)).toContainText("Roughly how much will the order be?");
  await page.click("#newBtn");
  await say(page, "Flowers for all 40 branches every week for 2 years, 60k");
  expect(await page.evaluate(() => S.det.route)).toBe("sourcing");
});

test("a magician at €600 is a low-value purchase with four questions; a yes on data moves it to three quotes", async ({ page }) => {
  await openApp(page);
  await say(page, "A magician for the kids' Christmas party, about 600 euros");
  expect(await page.evaluate(() => [S.det.route, S.f.purpose])).toEqual(["lowvalue", "the kids' Christmas party"]);
  await expect(lastAssistant(page)).toContainText("low-value purchase");
  const asked = await answerAll(page, { needed_by: "12 December 2026", location: "our Frankfurt office", supplier: "No preference", personal_data: "No access" });
  expect(asked).toEqual(["needed_by", "location", "supplier", "personal_data"]);
  const got = await page.evaluate(() => ({ route: S.det.route, controls: S.det.controls.map((c) => c[1]), steps: S.det.steps.join(" "), why: S.det.why }));
  expect(got.route).toBe("lowvalue");
  expect(got.controls).toEqual(["One quote", "No splitting"]);
  expect(got.steps).toMatch(/one quote.*purchase order.*corporate card/i);
  expect(got.why).toMatch(/under the €5,000 low-value limit/);
  await expect(page.locator(".rec-h h2")).toHaveText("Low-value purchase");
  await expect(page.locator(".sd .sd-h")).toContainText("Purchase request");
  // the provider would see client data: the standard path with its checks
  await page.evaluate(() => { S.f.personal_data = true; refresh(); });
  expect(await page.evaluate(() => S.det.route)).toBe("quote");
});

test("the low-value limit, software, a guessed category and amounts per unit", async ({ page }) => {
  await openApp(page);
  const route = async (text) => { await page.click("#newBtn"); await say(page, text); return page.evaluate(() => ({ route: S.det.route, value: S.f.value, cat: S.f.category, controls: S.det.controls.map((c) => c[1]), last: (S.msgs.filter((m) => m.role === "assistant").pop() || {}).text || "" })); };
  // (a photographer would be a call-off: the creative framework covers photography)
  expect((await route("An interpreter for our team offsite in Lisbon, about 4,900 euros")).route).toBe("lowvalue");
  expect((await route("An interpreter for our two-day client conference, about 5,100 euros")).route).toBe("quote");
  expect((await route("A diagramming add-on licence for my team, about 300 euros")).route).not.toBe("lowvalue");   // software always gets the ICT and data checks
  const guess = await route("Something nice for a retiring colleague, about 100 euros");
  expect(guess.route).toBe("lowvalue");
  expect(guess.controls).toEqual(["One quote", "No splitting"]);   // no consulting checks for a guessed category
  expect(guess.last).not.toMatch(/low for management consulting/);
  expect((await route("Christmas presents for our top 200 private banking clients, around 80 EUR each")).value).toBe(16000);
  expect(await page.evaluate(() => [monthsOf("Under 3 months"), monthsOf("3–6 months")])).toEqual([2, 6]);
});

test("generic words don't pick a category: a cake goes to catering, a birthday card to greeting cards", async ({ page }) => {
  await openApp(page);
  const got = [];
  for (const text of ["A cake for the team, 40 euros", "A birthday card for my colleague", "A book on Python for our analysts"]) {
    await page.click("#newBtn");
    await say(page, text);
    got.push(await page.evaluate(() => [S.det.route, S.det.catalogue.map((i) => i.name).join("")]));
  }
  expect(got).toEqual([["catalogue", "Meeting catering shop"], ["catalogue", "Greeting cards (10)"], ["catalogue", "Books and publications shop"]]);
});

test("the import reads the catalogue and refuses a shop without a maximum order or an item with an unknown Level 4", () => {
  const ROOT = path.join(__dirname, "..", "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalogue-import-"));
  const html = path.join(dir, "index.html");
  fs.copyFileSync(path.join(ROOT, "index.html"), html);
  const src = path.join(dir, "data");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "l4.csv"), "code,name,l1,l2,l3,theme,desc,kw\nL4-9001,Test flowers,Group,Sub,Leaf,facilities,Flowers for tests.,flowers\n");
  fs.writeFileSync(path.join(src, "catalogue.csv"), "id,kind,name,supplier,l4,price,max_order,unit,kw\nSHOP-1,shop,Florist shop,Test Florist,L4-9001,,,,flowers\nCAT-1,item,Vase,Test Florist,L4-9999,20,,each,vase\n");
  let err = "";
  try { execFileSync("python3", [path.join(ROOT, "scripts", "import_taxonomy.py"), src, "--html", html], { encoding: "utf8", stdio: "pipe" }); } catch (e) { err = e.stderr; }
  expect(err).toContain("shop SHOP-1 needs a max_order");
  expect(err).toContain("CAT-1 is linked to unknown Level 4 'L4-9999'");
  fs.writeFileSync(path.join(src, "catalogue.csv"), "id,kind,name,supplier,l4,price,max_order,unit,kw\nSHOP-1,shop,Florist shop,Test Florist,L4-9001,,1000,,flowers;bouquet\n");
  const out = execFileSync("python3", [path.join(ROOT, "scripts", "import_taxonomy.py"), src, "--html", html, "--version", "unit"], { encoding: "utf8" });
  expect(out).toContain("1 catalogue entries (1 shops)");
  const data = JSON.parse(fs.readFileSync(html, "utf8").match(/<script id="taxonomy-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  expect(data.catalogue).toEqual([{ id: "SHOP-1", kind: "shop", name: "Florist shop", supplier: "Test Florist", l4: "L4-9001", price: null, max_order: 1000, unit: "", kw: ["flowers", "bouquet"] }]);
});
