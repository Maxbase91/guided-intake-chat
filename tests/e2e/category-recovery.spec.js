// Wrong category (October 2026): "Support for S4 HANA Roll Out" became "Exhibition stands and displays" ("Roll" matched
// "roll-up banners"), the chat asked about guests and public officials, and "Its more Consulting support" changed nothing.
// These run on the real page with the rules only; the AI side is checked live on the deployed page.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, lastAssistant, start, pickCategory } = require("./helpers");

const EVENT_Q = /guests|public officials|invited/i;
const state = (page) => page.evaluate(() => ({ cat: S.f.category, l4: S.f.l4, asked: S.lastAsked, tech: S.f.tech_service }));

test("an S/4HANA rollout is ERP implementation in IT services, with IT questions and no event questions", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "Support for S4 HANA Roll Out");
  await expect(page.locator(".classcard").first()).toContainText("ERP and package implementation");
  await expect(lastAssistant(page)).toContainText("This sounds like IT services and development.");
  await pickCategory(page);
  expect(await state(page)).toMatchObject({ cat: "it-services", l4: "L4-1310", asked: "value", tech: true });
  await say(page, "300k for one year");
  await say(page, "Replacing SAP ECC with SAP S4 HANA technology globally");
  await expect(lastAssistant(page)).not.toContainText(EVENT_Q);
  await expect(page.locator("#msgs")).not.toContainText(/Exhibition stands|marketing and events/i);
  expect(errors).toEqual([]);
});

test("one shared word that is no search term never sets or overrules the category", async ({ page }) => {
  await openApp(page);
  await start(page, "Rolling out Windows 11 to 3000 laptops");
  expect((await state(page)).cat).toBe("it-hardware");   // "windows" alone is no window cleaning
  await page.click("#newBtn");
  await start(page, "We'd like to be main partner of the city marathon: our logo on runners' shirts and a stand at the finish line.");
  expect((await state(page)).cat).not.toBe("utilities");   // "finish line" is no water and wastewater
});

test("\"Its more Consulting support\" changes the category and the questions that follow", async ({ page }) => {
  const errors = await openApp(page);
  await start(page, "Support for our client event in March");
  expect(await state(page)).toMatchObject({ cat: "marketing", asked: "value" });
  await say(page, "Its more Consulting support");
  await expect(lastAssistant(page)).toContainText("Changed: category from Marketing and events to Management consulting");
  await expect(lastAssistant(page)).toContainText("Roughly what will this cost in total?");
  expect(await state(page)).toMatchObject({ cat: "consulting", asked: "value" });
  for (const answer of ["300k", "12 months", "Yes", "Our finance processes are slow and the audit flagged gaps; if delayed, the findings stay open"]) {
    await say(page, answer);
    await expect(lastAssistant(page)).not.toContainText(EVENT_Q);
  }
  expect((await state(page)).cat).toBe("consulting");
  expect(errors).toEqual([]);
});

test("a category named in answer to an open question is asked about, and \"it's my answer\" keeps it as the answer", async ({ page }) => {
  await openApp(page);
  await start(page, "Support for our client event in March");
  await say(page, "300k");
  expect((await state(page)).asked).toBe("background");
  await say(page, "It's more of a software problem");
  await expect(lastAssistant(page)).toContainText("Do you want me to change the category to Software and SaaS?");
  await choose(page, "No, it's my answer");
  const got = await page.evaluate(() => ({ cat: S.f.category, background: S.f.background }));
  expect(got.cat).toBe("marketing");
  expect(got.background).toMatch(/software problem/i);
});

test("\"it's more than 50k\" is no category change", async ({ page }) => {
  await openApp(page);
  await start(page, "Support for S4 HANA Roll Out");
  await say(page, "It's more than 50k");
  expect((await state(page)).cat).toBe("it-services");
  await expect(page.locator("#msgs")).not.toContainText("Changed: category");
});
