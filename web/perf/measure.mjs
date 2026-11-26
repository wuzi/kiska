import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  board,
  post,
  workspace,
  editor,
  profiles,
  configure,
  fixtureId,
} from "./profiles.mjs";

const origin = process.env.KISKA_URL || "http://127.0.0.1:8080";
const session = process.env.PERF_SESSION;
if (!session)
  throw new Error("Supply PERF_SESSION for the verified measurement account");
const count = Number(process.env.COLD_SAMPLES || 30),
  warm = Number(process.env.WARM_SAMPLES || 100);
const output = resolve(process.env.PERF_ARTIFACTS || "../artifacts/perf");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const smoke = await fetch(origin + "/api/v1/b/atlas-lab/community");
const fixture = await smoke.json();
if (fixture.total !== 10000 || fixture.posts[0]?.comment_count !== 1000)
  throw new Error("Seed the dedicated fixture before measuring");
const measures = {};
const report = {
  timestamp: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  build: createHash("sha256")
    .update(
      Buffer.from(
        await (await fetch(origin + "/assets/public.js")).arrayBuffer(),
      ),
    )
    .digest("hex"),
  browser: browser.version(),
  host: os.cpus()[0].model,
  image: process.env.PERF_IMAGE_ID || null,
  working_tree: execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim()
    ? "uncommitted changes"
    : "clean",
  profiles,
  fixture: { posts: fixture.total, comments: fixture.posts[0].comment_count },
  cold_samples: count,
  warm_samples: warm,
  measures,
};
const persist = () =>
  writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
function record(key, values, percentile, target) {
  const sorted = [...values].sort((a, b) => a - b);
  const measurement = sorted[Math.ceil((sorted.length * percentile) / 100) - 1];
  measures[key] = {
    samples: values,
    percentile,
    value_ms: measurement,
    target_ms: target,
    passed: measurement <= target,
  };
  console.log(
    key,
    "p" + percentile,
    measurement.toFixed(1) + "ms (" + values.length + " samples)",
  );
}
async function cold(route, key, profile, selector) {
  const samples = [];
  const populated = [];
  const candidates = new Set();
  for (let i = 0; i < count; i++) {
    const { context, page } = await configure(
      browser,
      origin,
      profile,
      profile === profiles.desktop ? session : null,
    );
    try {
      await page.addInitScript(() => {
        window.__pbLcp = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__pbLcp = entry.startTime;
            window.__pbCandidate =
              entry.element?.tagName +
              " " +
              (entry.element?.textContent || "").trim().slice(0, 90);
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      if (i === 0)
        await context.tracing.start({ screenshots: true, snapshots: true });
      await page.goto(route, { waitUntil: "load" });
      await page.locator(selector).first().waitFor({ state: "visible" });
      populated.push(await page.evaluate(() => performance.now()));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle");
      const lcp = await page.evaluate(() => window.__pbLcp);
      if (!lcp) throw new Error("LCP missing on " + route);
      samples.push(lcp);
      candidates.add(await page.evaluate(() => window.__pbCandidate));
      if (i === 0)
        await context.tracing.stop({ path: resolve(output, key + ".zip") });
    } finally {
      await context.close();
    }
  }
  record(key, samples, 75, 2500);
  measures[key].populated_ui_ms = populated;
  measures[key].lcp_candidates = [...candidates];
  await persist();
}
// Initiate from a trusted DOM click, then sample the first animation frame with
// the desired populated UI. A task queued after rAF observes the painted frame.
async function action(page, trigger, ready) {
  await page.evaluate(({ selector, text, pressed }) => {
    window.__pbPaint = null;
    document.addEventListener(
      "click",
      function start(event) {
        const check = () => {
          const node = document.querySelector(selector);
          if (
            node &&
            (!text || node.textContent.includes(text)) &&
            (pressed == null ||
              node.getAttribute("aria-pressed") === String(pressed)) &&
            node.getBoundingClientRect().height > 0
          ) {
            setTimeout(() => {
              window.__pbPaint = performance.now() - event.timeStamp;
            }, 0);
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      },
      { capture: true, once: true },
    );
  }, ready);
  await trigger.click();
  await page.waitForFunction(() => window.__pbPaint !== null, null, {
    polling: 10,
  });
  return page.evaluate(() => window.__pbPaint);
}
async function interactions() {
  const publicEnv = await configure(browser, origin, profiles.mobile);
  const { page, context } = publicEnv;
  const id = fixtureId("post", 1),
    title = "Save favorite routes offline";
  try {
    await page.goto(board);
    const card = page.locator('[data-post="' + id + '"]');
    const link = card.getByRole("link", { name: title });
    await link.waitFor();
    let held = true;
    await page.route("**/api/v1/b/*/*/posts/" + id + "?**", async (route) => {
      if (held) await new Promise((resolve) => setTimeout(resolve, 350));
      try {
        await route.continue();
      } catch {}
    });
    const results = [];
    for (let i = 0; i < warm; i++) {
      results.push(
        await action(page, link, { selector: ".pb-modal h2", text: title }),
      );
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator(".pb-modal").waitFor({ state: "detached" });
    }
    record("mobile-dialog", results, 95, 100);
    await persist();
    held = false;
    const votes = [];
    const button = card.locator(".pb-vote");
    for (let i = 0; i < warm; i++) {
      await page.waitForFunction(
        (s) => !document.querySelector(s)?.disabled,
        '[data-post="' + id + '"] .pb-vote',
      );
      const desired = (await button.getAttribute("aria-pressed")) !== "true";
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/posts/" + id + "/vote") &&
          r.request().method() === (desired ? "PUT" : "DELETE"),
      );
      votes.push(
        await action(page, button, {
          selector: '[data-post="' + id + '"] .pb-vote',
          pressed: desired,
        }),
      );
      const write = await response;
      if (!write.ok()) throw new Error("Vote returned HTTP " + write.status());
    }
    record("mobile-vote", votes, 95, 100);
    await persist();
  } finally {
    await context.close();
  }
  const desktop = await configure(browser, origin, profiles.desktop, session);
  try {
    await desktop.page.goto(editor);
    const control = desktop.page.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    await control.waitFor();
    const settings = [];
    for (let i = 0; i < warm; i++) {
      settings.push(
        await action(desktop.page, control, {
          selector: ".ws-inspector",
          text: "Opens on",
        }),
      );
      await desktop.page.getByRole("button", { name: "Close panel" }).click();
    }
    record("desktop-settings", settings, 95, 100);
    await persist();
  } finally {
    await desktop.context.close();
  }
}
try {
  const only = process.env.PERF_SURFACE;
  if (!only || only === "public-board")
    await cold(board, "mobile-board", profiles.mobile, ".pb-card");
  if (!only || only === "shared-post")
    await cold(post, "mobile-post", profiles.mobile, ".pb-detail");
  if (!only || only === "workspace")
    await cold(
      workspace,
      "desktop-workspace",
      profiles.desktop,
      ".ws-board-card, .ws-board-row, .ws-board-list, .ws-home h1",
    );
  if (!only || only === "actions") await interactions();
  if (Object.values(measures).some((x) => !x.passed)) process.exitCode = 1;
} finally {
  await persist();
  await browser.close();
}
