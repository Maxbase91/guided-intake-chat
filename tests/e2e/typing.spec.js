// Replies type out like someone writing: fast, line by line for long ones, and never in the way.
const { test, expect } = require("@playwright/test");
const { openApp, say, idle, lastAssistant, choices } = require("./helpers");

test.describe("with motion", () => {
  const reply = (page) => page.locator("#msgs .m.a .bub").last();
  const finished = (page) => page.waitForFunction(() => !document.querySelector("#msgs [data-typing]"), null, { timeout: 5000 });

  test("a reply types out within about a second, and its chips come after it", async ({ page }) => {
    await openApp(page, { motion: true });
    await page.fill("#inp", "We need 15 laptops for new joiners in Frankfurt.");
    const t0 = Date.now();
    await page.press("#inp", "Enter");
    await expect(page.locator("#msgs [data-typing]")).toHaveCount(1);
    const early = (await reply(page).innerText()).length;
    await finished(page);
    const ms = Date.now() - t0;
    const full = await lastAssistant(page).innerText();
    expect(early).toBeLessThan(full.length);
    expect(ms).toBeLessThan(2500);
    await expect(lastAssistant(page)).toContainText("Which of these categories fits your request best?");   // the category question comes first
  });

  test("a click on the reply shows it in full at once", async ({ page }) => {
    await openApp(page, { motion: true });
    await page.fill("#inp", "A new HR system to replace our payroll tool.");
    await page.press("#inp", "Enter");
    // click as soon as it starts typing (a short reply would otherwise finish first), and note how much was shown
    await page.waitForSelector("#msgs [data-typing]");
    const partial = await page.evaluate(() => { const el = document.querySelector("#msgs [data-typing]"); if (!el) return null; const n = el.innerText.length; el.click(); return n; });
    expect(partial).not.toBeNull();
    await expect(page.locator("#msgs [data-typing]")).toHaveCount(0);
    await expect(lastAssistant(page)).toContainText("Which of these categories fits your request best?");
    expect(partial).toBeLessThan((await lastAssistant(page).innerText()).length);
  });

  test("answer chips wait until the text is complete", async ({ page }) => {
    await openApp(page, { motion: true });
    await page.fill("#inp", "An agency for a client dinner for 40 people, around 30k.");
    await page.press("#inp", "Enter");
    await expect(page.locator("#msgs [data-typing]")).toHaveCount(1);
    expect(await choices(page).count()).toBe(0);
    await finished(page);
    await idle(page);
  });
});

test("with 'reduce motion' the reply appears at once", async ({ page }) => {
  await openApp(page);
  await page.fill("#inp", "We need 15 laptops for new joiners in Frankfurt.");
  await page.press("#inp", "Enter");
  await expect(page.locator(".typing")).toHaveCount(0);
  expect(await page.locator("#msgs [data-typing]").count()).toBe(0);   // checked once, right away: nothing types out
  await expect(lastAssistant(page)).toContainText("Which of these categories fits your request best?");
});
