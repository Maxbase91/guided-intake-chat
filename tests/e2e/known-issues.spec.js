// Defects found while assessing the app. Each test states the CORRECT behaviour. A defect that is still open is marked
// test.fail(), so the suite stays green and reports "unexpectedly passed" once it is fixed; then the marker is removed
// and the test guards the fix. All four defects found so far are fixed.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, lastAssistant, choices, answerUntilDone, sideFacts, mock, setThreshold } = require("./helpers");

const route = (page) => page.locator("#side .route");

test("an answer of the wrong kind is not recorded as the budget approval", async ({ page }) => {
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
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
  await say(page, "thanks");
  await expect(page.locator("#msgs")).not.toContainText("Updated. Here are the revised service description and route.", { timeout: 2000 });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  test("the summary panel can be closed again on a phone", async ({ page }) => {
    await openApp(page);
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    const side = page.locator("#side");
    for (const close of ["Escape", "button", "summary", "outside"]) {
      await page.click("#sumBtn");
      await expect(side).toHaveClass(/open/);
      await expect(page.locator("#side .route")).toBeInViewport();
      await page.waitForTimeout(300); // let the slide-in finish
      if (close === "Escape") await page.keyboard.press("Escape");
      if (close === "button") await page.click('#side [data-act="closeside"]');
      if (close === "summary") await page.click("#sumBtn");          // the header stays above the panel
      if (close === "outside") await page.mouse.click(20, 400);
      await expect(side, close).not.toHaveClass(/open/);
    }
  });
});

test.describe("AI mode", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ request }) => { await mock(request, { gemini: "ok", groq: "ok", mistral: "ok", coldStart: true, resetCalls: true, nextChat: null }); });

  test("an answer that mentions a 'summary' during the improvement round is taken as the answer", async ({ page }) => {
    await openApp(page, { kind: "ai" });
    await say(page, "An agency for a client dinner for 40 people, around 30k.");
    await setThreshold(page, "qualityMin", 100);
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
