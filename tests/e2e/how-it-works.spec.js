// The "How it works" panel: a specification generated from the page's own code, with the exact prompts and a Markdown download.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const { openApp, say, idle, lastAssistant, setThreshold, start } = require("./helpers");

const panel = (page) => page.locator("#specPaper");

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the link opens the specification at ${viewport.width}px, and Escape closes it`, async ({ page }) => {
    const errors = await openApp(page, { viewport });
    await expect(page.locator("#howBtn")).toBeVisible();
    await page.click("#howBtn");
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('[data-spec="close"]')).toBeFocused();
    for (const heading of ["When an AI model is called", "One message, step by step", "Routes and reviews", "What is asked, and when", "Kinds of work", "The prompts", "Quality"])
      await expect(panel(page)).toContainText(heading);
    await expect(panel(page)).toContainText("€50,000");
    await expect(panel(page)).toContainText("30–60");
    await expect(panel(page)).toContainText("Sponsor and stakeholders / Teams involved");   // the project lines, read from the code
    await expect(panel(page)).toContainText("Bank checks by category");
    expect(await page.evaluate(() => document.querySelector(".docwrap").scrollWidth - document.querySelector(".docwrap").clientWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("#howBtn")).toBeFocused();
    await expect(page.locator("body")).not.toHaveClass(/doc-open/);
    expect(errors).toEqual([]);
  });
}

test("the prompts are the ones the app sends, behind a toggle", async ({ page }) => {
  await openApp(page);
  await page.click("#howBtn");
  const chat = panel(page).locator("details", { hasText: "A. Chat turn: system prompt" });
  await expect(chat.locator("pre")).toBeHidden();
  await chat.locator("summary").click();
  await expect(chat.locator("pre")).toBeVisible();
  await expect(chat.locator("pre")).toContainText("You are the intake assistant of a corporate procurement team");
  await expect(panel(page).locator("details", { hasText: "B. Suggestion: system prompt" }).locator("pre")).toContainText("You write ONE suggested answer", { useInnerText: false });
  await expect(panel(page).locator("details", { hasText: "C. Documents: system prompt for new demand" }).locator("pre")).toContainText("description", { useInnerText: false });
  // the shown prompt is exactly what the code builds for that example
  const same = await page.evaluate(() => {
    const shown = [...document.querySelectorAll("#specPaper details")].find((d) => /A\. Chat turn: system prompt/.test(d.textContent)).querySelector("pre").textContent;
    return withExampleState(TRIES[0][2], () => chatSystem()) === shown;
  });
  expect(same).toBe(true);
});

test("thresholds in the specification follow the settings in the code", async ({ page }) => {
  await openApp(page);
  await setThreshold(page, "quickQuoteMax", 60000);
  await page.click("#howBtn");
  await expect(panel(page)).toContainText("€60,000");
});

test("the download is Markdown with the prompts, and never contains the requester's own words", async ({ page }) => {
  await openApp(page);
  await start(page, "A new HR system to replace our payroll tool, codename Zebrafinch.");
  await page.click("#howBtn");
  await expect(panel(page)).toContainText("Your current request");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-spec="md"]')]);
  expect(dl.suggestedFilename()).toBe("guided-intake-how-it-works.md");
  const md = fs.readFileSync(await dl.path(), "utf8");
  expect(md).toContain("# How Guided Intake works");
  expect(md).toContain("## 7. The prompts");
  expect(md).toContain("```text");
  expect(md).toContain("You are the intake assistant of a corporate procurement team");
  expect(md).toContain("You write ONE suggested answer");
  expect(md).not.toContain("Zebrafinch");
  expect(md).not.toContain("Your current request");
});

test("opening the specification mid-conversation leaves the conversation exactly as it was", async ({ page }) => {
  await openApp(page);
  await start(page, "A new HR system to replace our payroll tool.");
  await say(page, "About 400k");
  const snap = () => page.evaluate(() => JSON.stringify({ f: S.f, msgs: S.msgs, missing: S.missing, req: S.req, cid: S.cid, derived: S.derived, asked: S.asked, route: S.det && S.det.route, seq: CONV_SEQ }));
  const before = await snap();
  await page.evaluate(() => { window.__f = S.f; });
  for (let i = 0; i < 2; i++) { await page.click("#howBtn"); await expect(panel(page)).toBeVisible(); await page.click('[data-spec="close"]'); }
  expect(await snap()).toBe(before);
  expect(await page.evaluate(() => S.f === window.__f)).toBe(true);
  // and the conversation carries on normally
  const asked = await lastAssistant(page).innerText();
  await say(page, "Our payroll tool is end of life and payroll runs on spreadsheets; if delayed we miss the reporting deadline");
  await idle(page);
  expect(await lastAssistant(page).innerText()).not.toBe(asked);
});

test("the current-request block appears only once a request has started", async ({ page }) => {
  await openApp(page);
  await page.click("#howBtn");
  await expect(panel(page)).not.toContainText("Your current request");
  await page.click('[data-spec="close"]');
  await start(page, "We need 15 laptops for new joiners in Frankfurt.");
  await page.click("#howBtn");
  await expect(panel(page)).toContainText("Your current request");
  await expect(panel(page)).toContainText("So far: Catalogue order");
});
