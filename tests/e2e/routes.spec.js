// Full conversations in offline rules mode, one per buying route, from the first message to submission.
const { test, expect } = require("@playwright/test");
const { openApp, say, choose, answerUntilDone, sideFacts, downloadJSON, idle } = require("./helpers");

// realistic answers, picked by the question the app asks
const ANSWERS = [
  [/cost in total/i, "About 400k"],
  [/How long will the work run/i, "6 months"],
  [/business problem/i, "Our payroll tool is end of life in 2027 and payroll runs on manual spreadsheets; if this is delayed we miss the statutory reporting deadline"],
  [/use today/i, "Today an old on-premise payroll tool and spreadsheets; we have no team that could build a replacement"],
  [/must it be able to do/i, "Payroll for Germany and the UK, employee self-service and an audit trail; it works if 99.5% of payslips are correct in the first 3 months"],
  [/exactly must the provider do/i, "Find a venue, run the invitations and guest list, organise catering and host the evening for 40 guests"],
  [/supplier deliver/i, "A current-state process map, a target operating model and a rollout plan"],
  [/skills or experience/i, "Java 17, Spring Boot and payments experience"],
  [/day rate/i, "Around 900 euros a day"],
  [/work on\?/i, "Building the new payments API with our team"],
  [/When (do you need it|should it start)/i, "1 February 2027"],
  [/Where should it be delivered/i, "Frankfurt office, Taunusanlage 12"],
  [/Where and how/i, "On our premises in Frankfurt"],
  [/budget already approved/i, "Yes"],
  [/kind of data/i, "Employee names, salaries and bank details, stored in the EU"],
  [/access any of our/i, "No access"],
  [/access to our systems/i, "Yes, read access to the payments test system"],
];

async function finishAndSubmit(page, routeName) {
  const route = page.locator(".card .rec-h h2").last();
  await expect(route).toHaveText(routeName);
  // a below-threshold new demand offers an improvement round first; submitting anyway must stay possible
  if (await page.getByRole("button", { name: "Submit anyway" }).count()) await choose(page, "Submit anyway");
  await page.locator("[data-act=submit]").last().click();
  await idle(page);
  await expect(page.locator("#msgs .m.a").last()).toContainText(/Submitted\. Request REQ-\d{6} goes to/);
  await expect(page.locator("#msgs .m.a").last()).toContainText(routeName);
}

test("catalogue order: laptops are ordered from the catalogue", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await expect(page.locator("#msgs")).toContainText("IT hardware and peripherals");
  await expect(page.locator("#msgs")).toContainText("is in our catalogue");
  await expect(page.locator("#stepbar")).toContainText("Timing and delivery");
  await answerUntilDone(page, ANSWERS);

  await expect(page.locator(".rec-h h2")).toHaveText("Catalogue order");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("in the catalogue");
  const facts = await sideFacts(page);
  // the place came with the first message, so it is not asked again
  expect(facts).toMatchObject({ Item: "Laptops", Quantity: "15", "Where and how": "Frankfurt" });
  await expect(page.locator("#msgs")).not.toContainText("Where should it be delivered");
  await expect(page.locator(".sd .record")).toContainText("Buying route");
  // the description never carries the amount, the date or the place
  const desc = await page.locator(".sd .desc").innerText();
  expect(desc).not.toMatch(/€|Frankfurt|February|2027/);
  await expect(page.locator(".sd")).toContainText(/Strong|Good/);

  const { name, data } = await downloadJSON(page, async () => { await page.click("[data-act=more]"); await page.click(".more [data-act=json]"); });
  expect(name).toMatch(/^intake-\d+\.json$/);
  expect(data.decision).toMatchObject({ route: "catalogue", chosen: "catalogue", override: false });
  expect(data.facts).toMatchObject({ category: "it-hardware", quantity: 15 });
  expect(data.source).toBe("rules");
  expect(data.conversation[0]).toEqual({ role: "user", text: "We need 15 laptops for new joiners in Frankfurt." });

  await finishAndSubmit(page, "Catalogue order");
  await expect(page.locator(".sd .acts")).toContainText(/Submitted as REQ-\d{6}/);
  expect(errors).toEqual([]);
});

test("contract call-off: more support from the framework supplier", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "More support from Lakeshore Advisory for our operations team.");
  await expect(page.locator("#msgs")).toContainText("Operations consulting framework with Lakeshore Advisory");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("Contract call-off");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("No new competition is needed");
  await expect(page.locator(".sd .record")).toContainText("Lakeshore Advisory");
  await finishAndSubmit(page, "Contract call-off");
  expect(errors).toEqual([]);
});

test("external workers: contractors go through the staffing contract", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "Two Java developers as contractors for 9 months.");
  await expect(page.locator("#msgs")).toContainText("Contingent workforce and contractors");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("Contract call-off");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("External workers MSP with Tailspin Talent");
  const facts = await sideFacts(page);
  expect(facts).toMatchObject({ Role: "Java developer", People: "2", Duration: "9 months" });
  await finishAndSubmit(page, "Contract call-off");
  expect(errors).toEqual([]);
});

test("new demand under the threshold: business-led sourcing with three quotes", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "An agency for a client dinner for 40 people, around 30k.");
  await expect(page.locator("#msgs")).toContainText("Marketing, events and hospitality");
  await answerUntilDone(page, ANSWERS);
  await expect(page.locator(".rec-h h2")).toHaveText("New demand: business-led sourcing");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("at least three quotes");
  await expect(page.locator(".rec-h .meta")).toContainText("€30,000");
  await finishAndSubmit(page, "New demand: business-led sourcing");
  expect(errors).toEqual([]);
});

test("new demand over the threshold: procurement-led RFP with the full service description", async ({ page }) => {
  const errors = await openApp(page);
  await say(page, "A new HR system to replace our payroll tool.");
  await expect(page.locator("#msgs")).toContainText("Software as a service");
  await answerUntilDone(page, ANSWERS);

  // the check step lists what the rules worked out and was confirmed
  await expect(page.locator("#msgs")).toContainText("Here's what I've worked out from your answers");
  await expect(page.locator(".rec-h h2")).toHaveText("New demand: procurement-led sourcing");
  await expect(page.locator(".card .sec").filter({ hasText: "Why" })).toContainText("RFP");
  // executive format: headline, executive description, summary table, sourcing request text
  await expect(page.locator(".sd")).toContainText("1. Service description headline");
  await expect(page.locator(".sd")).toContainText("2. Executive service description");
  await expect(page.locator(".sd .srq .cmp")).not.toBeEmpty();
  await expect(page.locator(".sd .record")).toContainText("€400,000");
  await expect(page.locator(".sd .record")).toContainText("ICT service (DORA)");

  // the detailed document opens, and downloads as Word
  await page.click("[data-act=brd]");
  await expect(page.locator("#paper")).toBeVisible();
  await expect(page.locator("#paper")).toContainText("The Service Provider shall");
  const [doc] = await Promise.all([page.waitForEvent("download"), page.click("[data-doc=word]")]);
  expect(doc.suggestedFilename()).toMatch(/^BRD - .+\.doc$/);
  await page.click("[data-doc=close]");
  await expect(page.locator("#paper")).toHaveCount(0);

  await finishAndSubmit(page, "New demand: procurement-led sourcing");
  expect(errors).toEqual([]);
});
