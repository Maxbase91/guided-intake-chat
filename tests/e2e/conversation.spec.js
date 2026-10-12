// Conversation features in offline rules mode: corrections, checks, skipping, side panel edits, rules and outputs.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, idle, answerUntilDone, sideFacts, downloadJSON, lastAssistant, choices } = require("./helpers");

const DINNER = "An agency for a client dinner for 40 people, around 30k.";
const routeInPanel = (page) => page.locator("#side .route");
const ANSWERS = [
  [/business problem/i, "Client dinners are how we win new corporate clients; if this slips we lose the Q1 pipeline"],
  [/exactly must the provider do/i, "Find a venue, run the invitations and guest list, organise catering and host the evening for 40 guests"],
  [/When (do you need it|should it start)/i, "1 February 2027"],
  [/Where and how/i, "At the provider's venue in Frankfurt"],
  [/access any of our/i, "No access"],
  [/Where should it be delivered/i, "Frankfurt office"],
];

test("a budget correction mid-way re-routes across the €50,000 threshold", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, DINNER);
  await expect(routeInPanel(page)).toHaveText("New demand: business-led sourcing");
  await say(page, "sorry, the budget is 80k not 30k");
  await expect(lastAssistant(page)).toContainText("Changed: budget from €30,000 to €80,000");
  await expect(lastAssistant(page)).toContainText("New demand: procurement-led sourcing");
  await expect(lastAssistant(page)).toContainText("Back to where we were");
  await expect(routeInPanel(page)).toHaveText("New demand: procurement-led sourcing");
  await expect(page.locator("#stepbar")).toContainText("Running the service");
  // the correction is not taken as the answer to the open question
  expect((await sideFacts(page))["Problem to solve"]).not.toMatch(/80k/);
  expect(errors).toEqual([]);
});

test("changing the category in words re-routes to the framework contract", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "change the category to management consulting");
  await expect(lastAssistant(page)).toContainText("Changed: category from Marketing and events to Management consulting");
  await expect(routeInPanel(page)).toHaveText("Contract call-off");
});

test("an unclear correction is confirmed before anything changes", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "actually it's more a consulting job");
  await expect(lastAssistant(page)).toContainText("Do you want me to change");
  await expect(choices(page)).toHaveText(["Yes, change it", "No, it's my answer"]);
  await choose(page, "Yes, change it");
  await expect(page.locator("#side .prov")).toContainText("Management consulting");
});

test("a captured detail edited in the side panel updates the route", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await page.click('#side [data-edit="value"]');
  await expect(page.locator("#edv")).toHaveValue("30000");
  await page.fill("#edv", "250000");
  await page.click("#side [data-esave]");
  await idle(page);
  await expect(page.locator("#msgs")).toContainText("Changed: budget from €30,000 to €250,000");
  await expect(routeInPanel(page)).toHaveText("New demand: procurement-led sourcing");
  // an invalid value is refused and the editor stays open
  await page.click('#side [data-edit="value"]');
  await page.fill("#edv", "lots");
  await page.click("#side [data-esave]");
  await expect(page.locator("#edv")).toBeVisible();
  await page.click("#side [data-ecancel]");
  await expect(page.locator("#edv")).toHaveCount(0);
});

test("an off-topic answer is asked again once, then recorded as not given", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await say(page, "Mix flour, eggs and milk, then fry the pancakes in butter");
  await expect(lastAssistant(page)).toContainText("That doesn't seem to answer my question");
  await expect(page.locator("#msgs .m.u").last()).not.toContainText("Answer quality");   // no per-answer score is shown
  await say(page, "Bake the cake for 40 minutes at 180 degrees");
  expect((await sideFacts(page))["Problem to solve"]).toBe("To be determined");
});

test("a delivery date in the past gets a quick check and can be corrected", async ({ page }) => {
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await say(page, "by 1 October 2026");
  await expect(lastAssistant(page)).toContainText("seems to be in the past");
  await say(page, "1 December 2026");
  await expect(page.locator("#msgs")).toContainText("Strong");
  expect((await sideFacts(page))["Start / delivery"]).toMatch(/1 December 2026/);
});

test("a new date given in reply to the timeline check is stored without the words around it", async ({ page }) => {
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await say(page, "ASAP");
  await expect(lastAssistant(page)).toContainText("Is that a fixed deadline");
  await say(page, "ok then 1 December 2026");
  expect((await sideFacts(page))["Start / delivery"]).toBe("1 December 2026");
});

test("skipping a question records it as to be determined", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await choose(page, "Skip for now");
  expect((await sideFacts(page))["Problem to solve"]).toBe("To be determined");
});

test("an example on the welcome screen starts the conversation, and New starts over", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-try]").first().click();
  await idle(page);
  await expect(page.locator("#msgs .m.u").first()).toContainText("15 laptops");
  await expect(routeInPanel(page)).toHaveText("Catalogue order");
  await page.click("#newBtn");
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(page.locator("#msgs .m.u")).toHaveCount(0);
  await expect(page.locator("#side")).toContainText("Start by describing what you need");
  await expect(page.locator("#inp")).toBeFocused();
});

test("changing the sourcing threshold under Rules re-routes the current request", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await expect(routeInPanel(page)).toHaveText("New demand: business-led sourcing");
  await page.click("#cfgBtn");
  await expect(page.locator(".drawer")).toBeVisible();
  await expect(page.locator(".drawer")).toContainText("No server found");
  await page.fill("#t2", "20000");
  await page.click("#close");
  await expect(routeInPanel(page)).toHaveText("New demand: procurement-led sourcing");
});

test("a route override is recorded with its justification in the JSON payload", async ({ page }) => {
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
  await page.click("[data-act=more]");
  await page.selectOption("#ovr", "sourcing");
  await expect(page.locator(".ovr")).toContainText("A stricter route than needed");
  await page.fill("#just", "Group IT wants a tender for all laptop purchases this year");
  const { data } = await downloadJSON(page, () => page.click(".more [data-act=json]"));
  expect(data.decision).toMatchObject({ route: "catalogue", chosen: "sourcing", override: true, justification: "Group IT wants a tender for all laptop purchases this year" });
  await page.click("[data-act=submit]");
  await expect(lastAssistant(page)).toContainText("New demand: procurement-led sourcing");
});

test("below the quality threshold the chat offers an improvement round, and submitting anyway is recorded", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await page.click("#cfgBtn");
  await page.fill("#t4", "100");
  await page.click("#close");
  await choose(page, "Skip for now");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator("#msgs")).toContainText("Shall we go through them?");
  await expect(choices(page)).toHaveText(["Yes, let's improve it", "Submit anyway"]);
  await choose(page, "Submit anyway");
  await page.click("[data-act=submit]");
  await expect(lastAssistant(page)).toContainText("submitted below the quality threshold");
  const { data } = await downloadJSON(page, async () => { await page.click("[data-act=more]"); await page.click(".more [data-act=json]"); });
  expect(data.submitted_below_threshold).toBe(true);
  expect(data.quality_threshold).toBe(100);
});

test("the improvement round asks for the weak points and rebuilds the description", async ({ page }) => {
  await openApp(page);
  await say(page, DINNER);
  await page.click("#cfgBtn");
  await page.fill("#t4", "100");
  await page.click("#close");
  await choose(page, "Skip for now");
  await answerUntilDone(page, ANSWERS);
  await choose(page, "Yes, let's improve it");
  await expect(lastAssistant(page)).toContainText("Let's go through them, one at a time");
  // the weak points are asked again one by one (a start date counts as weak while the timeline is only partial)
  const ROUND = [...ANSWERS, [/kind of data/i, "Guest names and email addresses, stored in the EU"]];
  for (let i = 0; i < 6 && !(await page.locator("#msgs").innerText()).includes("that makes it stronger"); i++) {
    const q = await lastAssistant(page).innerText();
    const hit = ROUND.find(([re]) => re.test(q));
    if (!hit) throw new Error(`No scripted answer for: ${q}`);
    await say(page, hit[1]);
  }
  await expect(page.locator("#msgs")).toContainText("Thanks, that makes it stronger. I'm updating the service description now.");
  const facts = await sideFacts(page);
  expect(facts["Problem to solve"]).toMatch(/corporate clients/);
  const { data } = await downloadJSON(page, async () => { await page.locator("[data-act=more]").last().click(); await page.locator(".more [data-act=json]").last().click(); });
  expect(data.facts.data_details).toMatch(/Guest names/);
});

test("edits made directly in the service description are kept in the output", async ({ page }) => {
  await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
  const title = page.locator('.sd-h [data-sd="title"]');
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("New-joiner laptops for Frankfurt");
  await page.locator(".sd .record").click();
  const { data } = await downloadJSON(page, async () => { await page.click("[data-act=more]"); await page.click(".more [data-act=json]"); });
  expect(data.title).toBe("New-joiner laptops for Frankfurt");
});
