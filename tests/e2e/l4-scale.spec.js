// ~400 Level 4 categories (realistic test data): recognition by the rules and the AI shortlist, prompt size, speed,
// the search in the summary panel, How it works, and the import script. The numbers are printed for the report.
const { test, expect } = require("@playwright/test");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { openApp, say, mock, start } = require("./helpers");

const BENCH = require("../fixtures/l4-benchmark.json");
const ROOT = path.join(__dirname, "..", "..");

test("the rules and the AI shortlist find the right Level 4 among ~400 (benchmark of 60 requests)", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page);
  const rows = [];
  for (const b of BENCH) {
    await page.click("#newBtn");
    await start(page, b.text);
    rows.push(await page.evaluate((exp) => {
      const top = classifyL4(S.f).map((x) => x.code), sl = l4Shortlist().map((e) => e.code), themes = exp.map((c) => l4ByCode(c).cat);
      return { theme: themes.includes(S.f.category), top1: exp.includes(S.f.l4), top3: top.some((c) => exp.includes(c)), inShortlist: sl.some((c) => exp.includes(c)), got: S.f.l4, shortlist: sl.length };
    }, b.expect));
  }
  const rate = (k) => Math.round((100 * rows.filter((r) => r[k]).length) / rows.length);
  const result = { requests: rows.length, theme: rate("theme"), top1: rate("top1"), top3: rate("top3"), shortlist: rate("inShortlist"), maxShortlist: Math.max(...rows.map((r) => r.shortlist)) };
  console.log("L4 benchmark (rules):", JSON.stringify(result));
  console.log("misses:", JSON.stringify(BENCH.map((b, i) => [b.id, b.expect.join("/"), rows[i].got, rows[i].inShortlist]).filter((x, i) => !rows[i].top1)));
  // floors set from the first measurement (see docs/l4-recognition-report.md), so a change that makes recognition worse fails
  // measured with the test data: category 87%, Level 4 75%, shortlist 93% (the shortlist misses share no word with any entry: the AI's l4_terms cover them)
  expect(result.theme).toBeGreaterThanOrEqual(85);
  expect(result.top1).toBeGreaterThanOrEqual(72);
  expect(result.shortlist).toBeGreaterThanOrEqual(90);
  expect(result.maxShortlist).toBeLessThanOrEqual(21);
  expect(errors).toEqual([]);
});

test("the chat prompt stays small with ~400 entries, and matching is fast", async ({ page }) => {
  await openApp(page);
  await start(page, "I want to buy a process orchestration platform for procurement");
  const got = await page.evaluate(() => {
    const t0 = performance.now(); for (let i = 0; i < 50; i++) classifyL4(S.f); const ms = (performance.now() - t0) / 50;
    const t1 = performance.now(); for (let i = 0; i < 20; i++) l4Shortlist(); const msList = (performance.now() - t1) / 20;
    const det = S.det; S.det = null; const sys = chatSystem(), cands = (sys.match(/Level 4 candidates[^\n]*/) || [""])[0]; S.det = det;   // as on the first message
    return { entries: L4.length, ms, msList, sys: sys.length, cands: cands.length, fullList: L4.map((e) => `${e.code} ${e.name}`).join("; ").length };
  });
  console.log("prompt and speed:", JSON.stringify(got));
  expect(got.entries).toBeGreaterThanOrEqual(390);
  expect(got.cands).toBeGreaterThan(500);
  // the candidates are about 20 lines; the whole list would be ten times that
  expect(got.cands).toBeLessThan(2500);
  expect(got.cands * 5).toBeLessThan(got.fullList);
  expect(got.ms).toBeLessThan(5);
  expect(got.msList).toBeLessThan(15);
});

test("category and Level 4 never disagree: the AI's pick sets the category, a category named first wins", async ({ page }) => {
  await openApp(page);
  await start(page, "I want to buy a process orchestration platform for procurement");
  const got = await page.evaluate(() => {
    mergeFacts({ l4: "L4-2117" });   // procurement consulting
    const a = [S.f.category, S.f.l4];
    const c = catFromText("procurement consulting"), d = catFromText("it should be travel management company");
    return { a, c, d };
  });
  expect(got.a).toEqual(["consulting", "L4-2117"]);
  expect(got.c).toEqual({ cat: "consulting", l4: "L4-2117" });
  expect(got.d.cat).toBe("travel");
});

// from the live benchmark (October 2026): the AI chose right, and a category word at the start of the request overruled it
test("the AI's Level 4 stands against a category word at the start, unless it fits the words far worse", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  const cases = [
    ["Annual support and maintenance renewal for our database licences with the original vendor, due end of November, around 220k.", { l4: "L4-1247", category: "software" }, "L4-1247"],
    ["Analyst research seats for the CIO office, the kind with vendor rankings, market guides and inquiry calls.", { l4: "L4-1620", category: "market-data" }, "L4-1620"],
    // the subject is the trading system; the AI's KYC operations fit only the part after "including"
    ["We need to transform our front office trading system, including the client onboarding and KYC process. Budget around 4 million over 3 years", { l4: "L4-2802", category: "bpo" }, "L4-1217"],
  ];
  for (const [text, facts, want] of cases) {
    await page.click("#newBtn");
    await mock(request, { nextChat: { facts } });
    await start(page, text);
    expect(await page.evaluate(() => [S.f.l4, S.f.category === l4ByCode(S.f.l4).cat])).toEqual([want, true]);
  }
});

test("when no candidate fits, the AI's words for what is bought find the entry in the whole list", async ({ page, request }) => {
  await openApp(page, { kind: "ai" });
  await mock(request, { nextChat: { facts: { l4: "", l4_terms: "courier delivery" } } });
  await say(page, "Urgent: signed loan documents need to go from Frankfurt to a notary in Milan by tomorrow morning.");
  expect(await page.evaluate(() => [S.f.category, S.f.l4, /courier delivery/.test(S.f.l4_reason || "")])).toEqual(["facilities", "L4-2531", true]);
  expect(await page.evaluate(() => S.l4Cands[0].code)).toBe("L4-2531");   // and it is the suggested one in the category question
  // the candidates the AI saw: about 20 lines, each with its Level 2 and Level 3 group
  const sys = await page.evaluate(() => { S.det = null; return chatSystem(); });
  expect(sys).toMatch(/Level 4 candidates \(the closest of \d{3} entries/);
  expect(sys).toContain("l4_terms");
});

test("the summary panel finds a Level 4 by typing, and saving changes category and Level 4", async ({ page }) => {
  await openApp(page);
  await start(page, "I want to buy a process orchestration platform for procurement");
  await page.click('[data-edit="category"]');
  await expect(page.locator("#edv")).toHaveAttribute("list", "l4list");
  expect(await page.locator("#l4list option").count()).toBeGreaterThanOrEqual(390);
  await page.fill("#edv", "L4-2117 · Procurement and supply chain consulting · Consulting › Procurement and supply chain consulting");
  await page.click("[data-esave=category]");
  await expect.poll(() => page.evaluate(() => [S.f.category, S.f.l4])).toEqual(["consulting", "L4-2117"]);
});

test("How it works lists categories with counts, not 400 Level 4 rows", async ({ page }) => {
  await openApp(page);
  await page.click("#howBtn");
  const panel = page.locator("#specPaper");
  await expect(panel).toContainText("Level 4 list");
  await expect(panel).toContainText("Financial market infrastructure");
  expect(await panel.locator("tr").count()).toBeLessThan(300);
});

test("preferred suppliers follow the Level 4; long lists are shortened; frameworks cover their Level 4 entries", async ({ page }) => {
  await openApp(page);
  await start(page, "Daily cleaning for our new Hamburg office, three floors, starting 1 February");
  const got = await page.evaluate(() => ({ l4: S.f.l4, pref: preferredFor(S.f), contract: (contractFor(S.f) || {}).id, some: someNames(["A", "B", "C", "D", "E"]),
    other: preferredFor({ ...S.f, l4: "L4-2530" }), lake: knownSupplierIn("we would rather use lakeshore advisory"), key: supplierKey("Contoso Cloud") }));
  expect(got.pref).toContain("BrightClean");
  expect(got.contract).toBe("CTR-2501");
  expect(got.some).toBe("A, B, C and 2 more");
  expect(got.other).not.toEqual(got.pref);
  expect(got.lake).toBe("Lakeshore Advisory");
  expect(got.key).toBe("contoso cloud");   // Contoso Office shares the first word
});

test("the import script writes the data block and refuses rows without a valid category", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l4-import-"));
  const html = path.join(dir, "index.html");
  fs.copyFileSync(path.join(ROOT, "index.html"), html);
  const src = path.join(dir, "data");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "l4.csv"), 'code,name,l1,l2,l3,theme,desc,kw\nL4-9001,Test entry,Group,Sub,Leaf,software,"A test entry, with a comma.",alpha;beta\nL4-9002,Bad entry,Group,Sub,Leaf,nonsense,No theme here.,\n');
  fs.writeFileSync(path.join(src, "suppliers.csv"), "supplier,preferred_l4\nTest Supplier,L4-9001;L4-9999\n");
  let err = "";
  try { execFileSync("python3", [path.join(ROOT, "scripts", "import_taxonomy.py"), src, "--html", html], { encoding: "utf8", stdio: "pipe" }); } catch (e) { err = e.stderr; }
  expect(err).toContain("L4-9002 has no valid theme");
  expect(err).toContain("unknown code L4-9999");
  fs.writeFileSync(path.join(src, "l4.csv"), 'code,name,l1,l2,l3,theme,desc,kw\nL4-9001,Test entry,Group,Sub,Leaf,software,"A test entry, with a comma.",alpha;beta\n');
  fs.writeFileSync(path.join(src, "suppliers.csv"), "supplier,preferred_l4\nTest Supplier,L4-9001\n");
  const out = execFileSync("python3", [path.join(ROOT, "scripts", "import_taxonomy.py"), src, "--html", html, "--version", "unit"], { encoding: "utf8" });
  expect(out).toContain("1 Level 4 categories, 1 suppliers, 0 contracts");
  const block = fs.readFileSync(html, "utf8").match(/<script id="taxonomy-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(block);
  expect(data).toMatchObject({ version: "unit", l4: [{ code: "L4-9001", theme: "software", kw: ["alpha", "beta"] }], suppliers: [{ name: "Test Supplier", preferred_l4: ["L4-9001"] }] });
});
