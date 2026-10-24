// The requester chooses the category first (October 2026): after the first message, 2–3 Level 4 candidates with their
// Level 1 › 2 › 3 path, before any other question, on every route. Rules only, on the real page; the AI's alternatives
// are checked live on the deployed page.
const { test, expect } = require("@playwright/test");
const { openApp, say, start, pickCategory, choose, lastAssistant, choices } = require("./helpers");

const S4 = "Support for S4 HANA Roll Out";
const state = (page) => page.evaluate(() => ({ asked: S.lastAsked, cat: S.f.category, l4: S.f.l4, pick: S.f.l4_pick, cands: (S.l4Cands || []).map((c) => c.code) }));
const card = (page) => page.locator("#msgs .classcard").last();

test("the first message shows 2–3 candidates with path, code and match, and asks to choose before anything else", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, S4);
  const st = await state(page);
  expect(st.asked).toBe("l4_pick");
  expect(st.cands.length).toBeGreaterThanOrEqual(2);
  expect(st.cands.length).toBeLessThanOrEqual(3);
  const rows = card(page).locator("li");
  await expect(rows).toHaveCount(st.cands.length);
  await expect(rows.first()).toContainText("ERP and package implementation");
  await expect(rows.first()).toContainText("L4-1310");
  await expect(rows.first()).toContainText("90% match");
  await expect(rows.first()).toContainText("Suggested");
  await expect(rows.first().locator(".cp")).toHaveText("Technology › IT services › Application services");
  await expect(rows.nth(1)).toContainText("weaker match");   // core banking scores far lower than ERP: no inflated 78%
  await expect(lastAssistant(page)).toContainText("This sounds like IT services and development. Which of these categories fits your request best?");
  await expect(lastAssistant(page)).not.toContainText(/cost|budget/i);
  expect(await choices(page).allInnerTexts()).toEqual(["ERP and package implementation", "Core banking implementation", "None of these"]);
  await expect(card(page).locator("[data-act=pickl4]")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("the selection rule: all at 75% or more up to 3, at least 2, the top 3 when none reaches 75%", async ({ page }) => {
  await openApp(page);
  const got = await page.evaluate(() => {
    const L = (...m) => m.map((x, i) => ({ code: "C" + i, match: x }));
    const run = (l) => selectL4(l, 75).map((x) => `${x.code}:${x.match}${x.weak ? "w" : ""}`).join(" ");
    return [run(L(90, 85, 80, 78)), run(L(90, 50, 40)), run(L(60, 50, 40, 30)), run(L(90)), run(L(70, 80, 40))];
  });
  expect(got).toEqual(["C0:90 C1:85 C2:80", "C0:90 C1:50w", "C0:60w C1:50w C2:40w", "C0:90", "C0:70w C1:80"]);
});

test("a button, \"the second one\", a code or a name picks the category; the card shows the choice", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await say(page, "the second one");
  expect(await state(page)).toMatchObject({ l4: "L4-1311", pick: "L4-1311" });
  await expect(page.locator("#msgs")).toContainText("Thanks, I'll use Core banking implementation (L4-1311).");
  await expect(card(page).locator("li").nth(1)).toContainText("✓ Your choice");
  await expect(card(page).locator("[data-act=pickl4]")).toHaveCount(0);
  await expect(lastAssistant(page)).toContainText("Roughly what will this cost in total?");
  for (const [answer, code] of [["L4-1311", "L4-1311"], ["ERP and package implementation", "L4-1310"]]) {
    await page.click("#newBtn");
    await say(page, S4);
    await say(page, answer);
    expect((await state(page)).pick).toBe(code);
  }
  await page.click("#newBtn");
  await say(page, S4);
  await card(page).locator("[data-act=pickl4]").nth(1).click();
  expect((await state(page)).pick).toBe("L4-1311");
});

test("every route asks the category first; the route news comes with the question after it", async ({ page }) => {
  await openApp(page);
  const cases = [
    ["Flowers for a colleague's farewell, about 80 euros", /florist shop of Petal & Stem Florists/],
    ["A magician for our team event, about 600 euros", /low-value purchase/],
    ["We need 2 Java developers for 6 months, about 200k", /framework/i],
    ["A new HR system to replace our payroll tool", /Roughly what will this cost in total/],
  ];
  for (const [first, after] of cases) {
    await page.click("#newBtn");
    await say(page, first);
    expect((await state(page)).asked).toBe("l4_pick");
    await expect(lastAssistant(page)).not.toContainText(after);
    await pickCategory(page);
    await expect(lastAssistant(page)).toContainText(after);
  }
});

test("only one entry shares a word: the area's general entry, or the nearest in its group, is the second choice", async ({ page }) => {
  await openApp(page);
  await say(page, "Flowers for a colleague's farewell, about 80 euros");   // facilities has no "(other)" entry
  const chips = await choices(page).allInnerTexts();
  expect(chips.length).toBe(3);
  expect(chips[0]).toBe("Flowers and floral arrangements");
  await expect(card(page).locator("li").nth(1)).toContainText("Next to it in the list");
  await expect(card(page).locator("li").nth(1)).toContainText("weaker match");
  await page.click("#newBtn");
  await say(page, "Printer paper for the Frankfurt office");   // office has one: "Office supplies (other)"
  await expect(card(page)).toContainText(/Office supplies \(other\)|Printer paper/);
});

test("\"None of these\" asks for a few words and suggests again, without the rejected entries", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  const before = (await state(page)).cands;
  await choose(page, "None of these");
  await expect(lastAssistant(page)).toContainText("What is it, in a few words?");
  expect(await choices(page).count()).toBe(0);
  await say(page, "SAP consulting support");
  const st = await state(page);
  expect(st.asked).toBe("l4_pick");
  expect(st.cands.some((c) => before.includes(c))).toBe(false);
  await expect(page.locator("#msgs .classcard")).toHaveCount(2);
  await expect(lastAssistant(page)).toContainText("Here's what fits that best.");
  await expect(card(page).locator("li").first()).toContainText("Technology consulting");
  await pickCategory(page, "Technology consulting");
  expect(await state(page)).toMatchObject({ cat: "consulting", l4: "L4-2102" });   // another category: the questions follow it
});

test("an answer that is no choice is kept and the question comes again; the second time the first candidate is kept", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await say(page, "About 400k");
  expect(await page.evaluate(() => S.f.value)).toBe(400000);
  expect((await state(page)).asked).toBe("l4_pick");
  await expect(lastAssistant(page)).toContainText("Thanks, noted. Which of these categories fits your request best?");
  await say(page, "for one year");
  expect((await state(page)).pick).toBe("L4-1310");
  await expect(page.locator("#msgs")).toContainText("I'll keep ERP and package implementation (L4-1310) as the category for now.");
  expect(await page.evaluate(() => S.l4Chosen.how)).toBe("kept");
});

test("\"skip\" and \"you decide\" keep the suggested category", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await say(page, "skip");
  expect((await state(page)).pick).toBe("L4-1310");
  await page.click("#newBtn");
  await say(page, S4);
  await say(page, "you decide");
  expect((await state(page)).pick).toBe("L4-1310");
});

test("\"Its more Consulting support\" during the question suggests consulting entries", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await say(page, "Its more Consulting support");
  const st = await state(page);
  expect(st).toMatchObject({ asked: "l4_pick", cat: "consulting" });
  await expect(card(page).locator("li").first()).toContainText("consulting");
  await expect(lastAssistant(page)).toContainText("Which of these categories fits your request best?");
});

test("the category set with ✎ in the summary answers the question", async ({ page }) => {
  await openApp(page);
  await say(page, S4);
  await page.click("[data-edit=category]");
  await page.fill("#edv", "L4-2102");
  await page.click("[data-esave=category]");
  await expect(lastAssistant(page)).toContainText("Roughly what will this cost in total?");
  expect(await state(page)).toMatchObject({ pick: "L4-2102", cat: "consulting" });
});

test("a check on the first message waits until the category is chosen", async ({ page }) => {
  await openApp(page);
  await say(page, "A new HR system to replace our payroll tool, budget 3k");
  expect((await state(page)).asked).toBe("l4_pick");
  await expect(page.locator("#msgs")).not.toContainText("Just to check");
  await pickCategory(page);
  await expect(lastAssistant(page)).toContainText("Just to check: €3,000 is low for software and saas work like this.");
});

test("a vague first message still asks what is needed first", async ({ page }) => {
  await openApp(page);
  await say(page, "Hi");
  expect((await state(page)).asked).toBe("need");
  await start(page, "Support for S4 HANA Roll Out");
  expect((await state(page)).pick).toBe("L4-1310");
});

test("the check step, the record and the JSON say the category was chosen by the requester", async ({ page }) => {
  await openApp(page);
  await start(page, S4, { pick: "Core banking implementation" });
  const got = await page.evaluate(() => ({ check: checkMessage(), pay: payload() }));
  expect(got.check).toContain("Core banking implementation** (L4-1311, chosen by you)");
  expect(got.pay.l4_choice).toMatchObject({ code: "L4-1311", how: "chosen" });
  expect(got.pay.l4_candidates.map((c) => c.code)).toEqual(["L4-1310", "L4-1311"]);
  expect(got.pay.l4_candidates[0].path).toBe("Technology › IT services › Application services");
});

test("external workers are offered staffing entries only", async ({ page }) => {
  await openApp(page);
  await say(page, "We need 2 contractors with Java skills for 6 months at a day rate of 800 euros");
  const st = await state(page);
  expect(st.cat).toBe("contingent");
  expect(await page.evaluate(() => S.l4Cands.every((c) => c.cat === "contingent"))).toBe(true);
});

test("on a phone the candidates fit the screen", async ({ page }) => {
  await openApp(page, { viewport: { width: 390, height: 844 } });
  await say(page, S4);
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
