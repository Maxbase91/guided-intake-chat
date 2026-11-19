// Level 4 matching settings and additional categories (November 2026): how many categories the card shows, the
// low-confidence cut-off, and "Also includes" — up to l4Extra more categories whose checks apply too. Rules only.
const { test, expect } = require("@playwright/test");
const { openApp, say, start, pickCategory, setThreshold, downloadJSON } = require("./helpers");

const S4 = "Support for S4 HANA Roll Out";
const CALLOFF = "More support from Lakeshore Advisory for our operations team.";
const card = (page) => page.locator("#msgs .classcard").last();

test("the most and fewest categories shown and the match bar are settings", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    const L = (...m) => m.map((x, i) => ({ code: "C" + i, match: x }));
    const run = (l, T = 75) => selectL4(l, T).map((x) => `${x.code}:${x.match}${x.weak ? "w" : ""}`).join(" ");
    const out = [];
    Object.assign(CONFIG.thresholds, { l4Max: 4, l4Min: 2 }); out.push(run(L(90, 85, 80, 78, 76)), run(L(60, 50, 40, 30, 20)));
    Object.assign(CONFIG.thresholds, { l4Max: 2, l4Min: 1 }); out.push(run(L(90, 85, 80)), run(L(90, 50, 40)));
    Object.assign(CONFIG.thresholds, { l4Max: 3, l4Min: 3 }); out.push(run(L(90, 50, 40, 30)));
    out.push(run(L(90, 85, 80), 95));
    applyConfig(DEFAULTS);
    return out;
  });
  expect(got).toEqual(["C0:90 C1:85 C2:80 C3:78", "C0:60w C1:50w C2:40w C3:30w", "C0:90 C1:85", "C0:90", "C0:90 C1:50w C2:40w", "C0:90w C1:85w C2:80w"]);
});

test("the low-confidence cut-off is a match percentage turned into the word score the rules use", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    const at = (p) => { const c = structuredClone(DEFAULTS); c.params.find((x) => x.key === "l4Low").value = p; applyConfig(c); return Math.round(L4_WEAK * 100) / 100; };
    const out = [at(57), at(80), l4Pct(at(70))];
    applyConfig(DEFAULTS);
    return out;
  });
  expect(got).toEqual([7.95, 24, 70]);
});

test("'Also includes' adds a second category: listed in the summary and the request; removed again", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, S4, { pick: "ERP and package implementation" });
  const second = card(page).locator("li").filter({ hasText: "Core banking implementation" });
  await expect(second.locator("[data-act=alsol4]")).toHaveText("＋ Also includes");
  await expect(card(page)).toContainText("Add up to 2 with “Also includes”");
  await second.locator("[data-act=alsol4]").click();
  await expect(page.locator("#msgs")).toContainText("Noted: it also includes Core banking implementation");
  await expect(second.locator("[data-act=alsol4]")).toHaveText("✓ Also includes");
  await expect(page.locator("#side .xcat").first()).toContainText("Also includes Core banking implementation");
  const code = await page.evaluate(() => S.l4Extra[0]);
  const { data } = await downloadJSON(page, () => page.evaluate(() => download()));
  expect(data.l4_extra.map((x) => x.code)).toEqual([code]);
  // the main category cannot also be an additional one; removing it from the summary drops it
  await expect(card(page).locator("li.picked [data-act=alsol4]")).toHaveCount(0);
  await page.locator(`#side [data-xrm="${code}"]`).click();
  await expect(page.locator("#msgs")).toContainText("Removed Core banking implementation");
  expect(await page.evaluate(() => S.l4Extra)).toEqual([]);
  expect(errors).toEqual([]);
});

test("an additional category's checks apply and a contract must cover every category", async ({ page }) => {
  await openApp(page);
  await start(page, CALLOFF);
  expect(await page.evaluate(() => S.det.route)).toBe("contract");
  expect(await page.evaluate(() => S.det.controls.some((c) => c[7] === "R32"))).toBe(false);
  await page.locator('#side [data-edit="xcategory"]').click();
  await page.fill("#edv", "L4-2201 · Legal services (general counsel support)");
  await page.locator("#side [data-esave]").click();
  await expect(page.locator("#msgs")).toContainText("Noted: it also includes Legal services (general counsel support)");
  const st = await page.evaluate(() => ({ route: S.det.route, legal: S.det.controls.find((c) => c[7] === "R32"), view: Object.fromEntries(catViews(S.f).map((x) => [x.category, requiredFor(S.det.route, x).length])) }));
  expect(st.route).not.toBe("contract");   // the consulting framework does not cover legal services
  expect(st.legal[1]).toContain("(Legal services (general counsel support))");
  expect(Object.keys(st.view)).toEqual(["consulting", "legal"]);
});

test("'Also includes' is offered from the start: tick another category, then choose the main one", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, S4);
  expect(await page.evaluate(() => S.lastAsked)).toBe("l4_pick");
  await expect(card(page)).toContainText("Tick “Also includes” on up to 2 of them, then choose the main one");
  await expect(card(page).locator("[data-act=alsol4]")).toHaveCount(2);   // every offered category, before any choice
  await card(page).locator("li").filter({ hasText: "Core banking implementation" }).locator("[data-act=alsol4]").click();
  expect(await page.evaluate(() => [S.lastAsked, S.l4Extra.length])).toEqual(["l4_pick", 1]);   // still the category question
  await pickCategory(page, "ERP and package implementation");
  await expect(page.locator("#msgs")).toContainText("Thanks, I'll use ERP and package implementation (L4-1310). It also includes Core banking implementation; their checks apply too.");
  await expect(page.locator("#side .xcat").first()).toContainText("Also includes Core banking implementation");
  // ticking the one then chosen as main leaves no duplicate
  expect(await page.evaluate(() => extraL4().map((e) => e.name))).toEqual(["Core banking implementation"]);
  expect(errors).toEqual([]);
});

test("a ticked category that is then chosen as the main one is not also an additional one", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await card(page).locator("li").filter({ hasText: "Core banking implementation" }).locator("[data-act=alsol4]").click();
  await pickCategory(page, "Core banking implementation");
  expect(await page.evaluate(() => [S.f.l4, S.l4Extra])).toEqual(["L4-1311", []]);
});

test("with 0 additional categories allowed, the card and the summary offer none", async ({ page }) => {
  await openApp(page);
  await setThreshold(page, "l4Extra", 0);
  await start(page, S4, { pick: "ERP and package implementation" });
  await expect(card(page).locator("[data-act=alsol4]")).toHaveCount(0);
  await expect(page.locator('#side [data-edit="xcategory"]')).toHaveCount(0);
  await expect(card(page)).not.toContainText("Also includes");
});
