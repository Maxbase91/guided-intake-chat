// Known defects found while assessing the app. Each test states the CORRECT behaviour and is marked test.fail(),
// so the suite stays green while the defect exists and reports "unexpectedly passed" once it is fixed.
// When that happens, remove the test.fail() line so the test guards the fix.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices, answerUntilDone, sideFacts, mock } = require("./helpers");

const route = (page) => page.locator("#side .route");

test("a software request that mentions a hardware word is not offered the hardware from the catalogue", async ({ page }) => {
  test.fail(true, "category keyword ties go to the first category listed (IT hardware), so 'laptop' outweighs 'software'");
  await openApp(page);
  await say(page, "Software to manage our laptop fleet, 20k");
  await expect(page.locator("#msgs")).not.toContainText("is in our catalogue", { timeout: 2000 });
  await expect(route(page)).not.toHaveText("Catalogue order", { timeout: 2000 });
});

test("acronyms keep their capitals in generated text", async ({ page }) => {
  test.fail(true, "sentence builders lower-case the first letter of category names and answers ('it hardware', 'hR operations')");
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await expect(page.locator("#msgs")).not.toContainText("fits it hardware", { timeout: 2000 });
});

test("an answer of the wrong kind is not recorded as the budget approval", async ({ page }) => {
  test.fail(true, "offline reading turns any answer to the approval question into yes/no/partly");
  await openApp(page);
  await say(page, "A new HR system to replace our payroll tool.");
  const ANSWERS = [
    [/cost in total/i, "About 400k"],
    [/business problem/i, "Our payroll tool is end of life and payroll runs on spreadsheets; if delayed we miss the reporting deadline"],
    [/use today/i, "An old on-premise tool; we have no team to build a replacement"],
    [/must it be able to do/i, "Payroll for Germany and the UK and an audit trail; it works if 99.5% of payslips are correct"],
    [/When (do you need it|should it start)/i, "Go live by 1 September 2027"],
  ];
  for (let i = 0; i < 20; i++) {
    const q = await lastAssistant(page).innerText();
    if (/budget already approved/i.test(q)) break;
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) { await choose(page, "Use this suggestion"); continue; }
    const hit = ANSWERS.find(([re]) => re.test(q));
    if (hit) await say(page, hit[1]); else await choose(page, chips[0]);
  }
  await say(page, "Frankfurt and London");
  expect((await sideFacts(page))["Budget approved"]).not.toBe("No");
});

test("a closing remark after the results is not answered as an update", async ({ page }) => {
  test.fail(true, "after the results, every message (even 'thanks') is scored and answered with 'Updated. Here are the revised…'");
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
  await say(page, "thanks");
  await expect(page.locator("#msgs")).not.toContainText("Updated. Here are the revised service description and route.", { timeout: 2000 });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  test("the summary panel can be closed again on a phone", async ({ page }) => {
    test.fail(true, "the open panel covers the Summary button, and there is no close button, backdrop or Escape handler");
    await openApp(page);
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    await page.click("#sumBtn");
    await expect(page.locator("#side")).toHaveClass(/open/);
    await expect(page.locator("#side .route")).toBeInViewport();
    await page.waitForTimeout(400); // let the slide-in finish
    await page.keyboard.press("Escape");
    await page.click("#sumBtn", { timeout: 2000 }).catch(() => {});
    await expect(page.locator("#side")).not.toHaveClass(/open/, { timeout: 2000 });
  });
});

test.describe("AI mode", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ request }) => { await mock(request, { gemini: "ok", groq: "ok", mistral: "ok", coldStart: true, resetCalls: true, nextChat: null }); });

  test("an amount the AI returns as text ('€400k') is read as 400,000", async ({ page, request }) => {
    test.fail(true, "normFact strips non-digits from AI values, so '€400k' becomes 400 and the request drops below the RFP threshold");
    await openApp(page, { kind: "ai" });
    await mock(request, { nextChat: { facts: { value: "€400k", value_is_estimate: false } } });
    await say(page, "A new HR system to replace our payroll tool.");
    await expect(route(page)).toHaveText("New demand: procurement-led sourcing", { timeout: 2000 });
  });

  test("an answer that mentions a 'summary' during the improvement round is taken as the answer", async ({ page }) => {
    test.fail(true, "once a description exists, any message with 'summary', 'description' or 'document' is sent to refineSD");
    await openApp(page, { kind: "ai" });
    await say(page, "An agency for a client dinner for 40 people, around 30k.");
    await page.click("#cfgBtn"); await page.fill("#t4", "100"); await page.click("#close");
    await choose(page, "Skip for now");
    await answerUntilDone(page, [
      [/exactly must the provider do/i, "Find a venue, run the invitations, organise catering and host the evening"],
      [/When (do you need it|should it start)/i, "1 February 2027"],
      [/Where and how/i, "At the provider's venue in Frankfurt"],
      [/kind of data/i, "Guest names and emails, stored in the EU"],
    ]);
    await choose(page, "Yes, let's improve it");
    await say(page, "Client dinners win us corporate clients, and a summary of the pipeline shows a 20% drop if this slips");
    await expect(page.locator("#msgs")).not.toContainText("Done, the service description and the requirements document are updated", { timeout: 2000 });
  });
});
