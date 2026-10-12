// The access-code gate (server with ACCESS_CODE) and the phone layout.
const { test, expect } = require("@playwright/test");
const { openApp, say, answerUntilDone, idle } = require("./helpers");

test.describe("access code gate", () => {
  test("the page stays locked until the server accepts the code, and remembers it for the tab", async ({ page }) => {
    const errors = await openApp(page, { kind: "gated", waitReady: false });
    await expect(page.locator("#gateForm")).toBeVisible();
    await expect(page.locator("#gateCode")).toBeFocused();
    await page.click("#gateBtn");
    await expect(page.locator("#gateErr")).toHaveText("Please enter the code.");
    await page.fill("#gateCode", "wrong-code");
    await page.click("#gateBtn");
    await expect(page.locator("#gateErr")).toHaveText("That code isn't right.");
    await expect(page.locator("#gateCode")).toHaveValue("");
    await page.fill("#gateCode", "demo-code");
    await page.press("#gateCode", "Enter");
    await expect(page.locator("#gate")).toBeHidden();
    await expect(page.locator("#aiLabel")).toHaveText("AI on");
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    await expect(page.locator("#aiLabel")).toHaveText("AI on · Gemini");
    // same tab: no second prompt after a reload
    await page.reload();
    await expect(page.locator("#gate")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("the API refuses chat calls without the code", async ({ request }) => {
    const r = await request.post("http://localhost:4312/api/llm", { data: { system: "s", history: [{ role: "user", content: "hi" }] } });
    expect(r.status()).toBe(401);
    const status = await (await request.get("http://localhost:4312/api/llm")).json();
    expect(status).toMatchObject({ ok: true, accessRequired: true });
  });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling, and the summary opens as a panel", async ({ page }) => {
    const errors = await openApp(page);
    const overflow = () => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expect(page.locator("#sumBtn")).toBeVisible();
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await expect(page.locator("#side")).not.toBeInViewport();
    await page.click("#sumBtn");
    await expect(page.locator("#side")).toHaveClass(/open/);
    await expect(page.locator("#side .route")).toBeInViewport();
    // closing it again is a known issue (see known-issues.spec.js); start a fresh page for the document
    await page.reload();
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    await answerUntilDone(page, [[/When (do you need it|should it start)/i, "15 December 2026"]]);
    await page.click("[data-act=brd]");
    await expect(page.locator("#paper")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
