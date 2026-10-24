// Shared helpers for the end-to-end tests.
const { expect } = require("@playwright/test");

const PORTS = { offline: 4310, ai: 4311, gated: 4312 };
const urlFor = (kind) => `http://localhost:${PORTS[kind]}/`;
// a fixed "today" so date checks ("that date is in the past") are deterministic
const TODAY = new Date("2026-10-12T09:00:00Z");

// opens the app; collects page errors so each test can assert there were none
// replies appear at once, as for users with "reduce motion" (typing.spec.js passes motion: true to see them type out)
async function openApp(page, { kind = "offline", viewport, waitReady = true, motion = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.emulateMedia({ reducedMotion: motion ? "no-preference" : "reduce" });
  if (viewport) await page.setViewportSize(viewport);
  await page.clock.install({ time: TODAY });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(urlFor(kind));
  if (waitReady) {
    await expect(page.locator("#gate")).toBeHidden();
    await expect(page.locator(".welcome")).toBeVisible();
  }
  return errors;
}

async function idle(page) {
  await expect(page.locator(".typing")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("#msgs [data-typing]")).toHaveCount(0, { timeout: 30_000 });   // a reply still typing out
  await expect(page.locator("#send")).toBeEnabled();
}

// types a message and waits until the assistant has answered
async function say(page, text) {
  await idle(page);
  await page.fill("#inp", text);
  await page.press("#inp", "Enter");
  await idle(page);
}

// clicks a quick-reply chip below the chat
async function choose(page, label) {
  await idle(page);
  await page.locator("#qr button", { hasText: label }).first().click();
  await idle(page);
}

const lastAssistant = (page) => page.locator("#msgs .m.a").last();
const choices = (page) => page.locator("#qr button");

// the category question after the first message: 2–3 candidates with their Level 1 › 2 › 3 path, one button each and
// "None of these"; picks one like a requester would (by default the first, the app's suggestion)
async function pickCategory(page, label) {
  await idle(page);
  expect(await page.evaluate(() => S.lastAsked)).toBe("l4_pick");
  const chips = await choices(page).allInnerTexts();
  expect(chips[chips.length - 1]).toBe("None of these");
  expect(chips.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#msgs .classcard").last().locator(".cp").first()).toContainText("›");
  const pick = label ?? chips[0];
  if (chips.includes(pick)) await page.locator("#qr button").filter({ hasText: pick }).first().click();
  else { await page.fill("#inp", pick); await page.press("#inp", "Enter"); }
  await idle(page);
  expect(await page.evaluate(() => S.lastAsked)).not.toBe("l4_pick");
}

// the first message, then the category question answered (by default with the app's suggestion)
async function start(page, text, { pick } = {}) {
  await say(page, text);
  if (await page.evaluate(() => S.lastAsked) === "l4_pick") await pickCategory(page, pick);
}

// answers the remaining questions until the result cards appear; answers are picked by the question text
async function answerUntilDone(page, answers, { max = 40 } = {}) {
  for (let i = 0; i < max; i++) {
    await idle(page);
    if (await page.locator("[data-act=submit]").count()) return;
    if (await page.evaluate(() => S.lastAsked) === "l4_pick") { await pickCategory(page); continue; }
    const chips = await choices(page).allInnerTexts();
    if (chips.includes("Use this suggestion")) { await choose(page, "Use this suggestion"); continue; }
    if (chips.includes("Yes, that's right")) { await choose(page, "Yes, that's right"); continue; }
    const q = await lastAssistant(page).innerText();
    const hit = answers.find(([re]) => re.test(q));
    if (hit) await say(page, hit[1]);
    else if (chips.length) await choose(page, chips[0]);
    else throw new Error(`No scripted answer for question: ${q}`);
  }
  throw new Error("Conversation did not finish");
}

// the side panel as { label: value } for the captured details
async function sideFacts(page) {
  return page.$$eval("#side .fact", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".k")?.innerText.trim(), e.querySelector(".v")?.innerText.trim()])));
}

async function downloadJSON(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const fs = require("fs");
  return { name: dl.suggestedFilename(), data: JSON.parse(fs.readFileSync(await dl.path(), "utf8")) };
}

// thresholds are set in the code (no Rules panel); a test changes one and the current request is re-routed, as a new deployment would
async function setThreshold(page, key, value) {
  await page.evaluate(([k, v]) => { CONFIG.thresholds[k] = v; if (S.det) { refresh(); if (!S.missing.length && S.sd) showRecommendation(); } render(); }, [key, value]);
}

async function mock(request, opts) {
  const r = await request.post(`http://localhost:${PORTS.ai}/__mock`, { data: opts });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

module.exports = { PORTS, urlFor, TODAY, openApp, idle, say, start, pickCategory, choose, lastAssistant, choices, answerUntilDone, sideFacts, downloadJSON, setThreshold, mock };
