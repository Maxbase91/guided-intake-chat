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

  test("a code the server stops accepting re-opens the gate; that turn runs on the rules", async ({ page }) => {
    const errors = await openApp(page, { kind: "gated", waitReady: false });
    await page.fill("#gateCode", "demo-code");
    await page.press("#gateCode", "Enter");
    await expect(page.locator("#gate")).toBeHidden();
    await page.evaluate(() => { CONFIG.accessCode = "changed-on-the-server"; });
    await say(page, "We need 15 laptops for new joiners in Frankfurt.");
    await expect(page.locator("#gateForm")).toBeVisible();
    await expect(page.locator("#gateErr")).toHaveText("The access code has changed or expired. Please enter it again.");
    await expect(page.locator("#msgs")).toContainText("Please enter it above");
    await page.fill("#gateCode", "demo-code");
    await page.press("#gateCode", "Enter");
    await expect(page.locator("#gate")).toBeHidden();
    expect(await page.evaluate(() => CONFIG.accessCode)).toBe("demo-code");
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

// with up to 9 steps the bar folds the others to circles: it never scrolls sideways, and only the current step is named
for (const [label, viewport] of [["a laptop", { width: 1280, height: 800 }], ["a phone", { width: 375, height: 812 }]]) {
  test(`the step bar fits on ${label} without scrolling`, async ({ page }) => {
    await openApp(page, { viewport });
    await say(page, "A new HR system to replace our payroll tool.");
    const bar = page.locator("#stepbar");
    await expect(bar).toHaveClass(/compact/);
    expect(await bar.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await expect(bar.locator(".st.cur .nm")).toBeVisible();
    expect(await bar.locator(".nm:not(.sr)").count()).toBe(1);
    // the other names are still there for screen readers and on hover
    await expect(bar).toContainText("Review");
    await expect(bar.locator(".st").last()).toHaveAttribute("title", /Review/);
  });
}

test("the side panel has no general note about rules and the AI", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#side")).not.toContainText("fixed rules");
  await say(page, "We need 15 laptops for new joiners in Frankfurt.");
  await expect(page.locator("#side")).not.toContainText("fixed rules");
  await expect(page.locator("#side .route")).toHaveText("Catalogue order");
});

// the welcome screen fits without scrolling on a small laptop window (1366x768 screen with the browser bar) and on a phone
for (const viewport of [{ width: 1366, height: 650 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`the welcome screen fits in ${viewport.width}x${viewport.height} without scrolling`, async ({ page }) => {
    await openApp(page, { viewport });
    await expect(page.locator(".welcome [data-try]")).toHaveCount(9);
    expect(await page.locator("#msgs").evaluate((b) => b.scrollHeight - b.clientHeight)).toBeLessThanOrEqual(0);
  });
}
