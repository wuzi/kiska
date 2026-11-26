import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { profileComponent } from "./render-profile";

const path = process.env.KISKA_E2E_BOARD || "/b/atlas-lab/community";
test.beforeEach(async ({ page }) => {
  await page.goto(path);
  await expect(page.locator(".pb-card").first()).toBeVisible();
});

test("@public keeps lists, filters, known details and browser history usable while the network is delayed", async ({
  page,
}) => {
  const card = page.locator(".pb-card").first();
  const title = await card.locator("a").innerText();
  const status = await card.locator(".pb-status").innerText();
  const votes = await card.locator(".pb-vote").innerText();
  const href = await card.locator("a").getAttribute("href");
  const [coldBoard, coldPost] = await Promise.all([
    page.request.get(path),
    page.request.get(href!),
  ]);
  expect((await coldBoard.text()).split("<script>")[0]).toContain(title);
  const html = (await coldPost.text()).split("<script>")[0];
  expect(html).toContain(title);
  expect(html).toContain('property="og:title"');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/b/*/*/posts/*?**", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await card.click({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator(".pb-vote")).toHaveText(votes);
  await expect(page.getByRole("dialog").locator(".pb-status")).toHaveText(
    status,
  );
  await expect(page).toHaveURL(/\/p\//);
  release();
  await expect(
    page.getByRole("dialog").locator(".pb-start-comment"),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.locator("a")).toBeFocused();
  await page.goForward();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});

test("@public reconciles a rejected vote without erasing another successful vote", async ({
  page,
}) => {
  const cards = page.locator(".pb-card");
  const first = cards.nth(0),
    second = cards.nth(1);
  const a = await first.getAttribute("data-post"),
    b = await second.getAttribute("data-post");
  const countA = Number(await first.locator(".pb-vote").innerText()),
    countB = Number(await second.locator(".pb-vote").innerText());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/posts/" + a + "/vote", async (route) => {
    await gate;
    await route.fulfill({ status: 403, json: { message: "Vote rejected" } });
  });
  await first.locator(".pb-vote").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first.locator(".pb-vote")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const confirm = page.waitForResponse(
    (r) => r.url().endsWith("/posts/" + b + "/vote") && r.status() === 200,
  );
  await second.locator(".pb-vote").click();
  await confirm;
  release();
  const liveA = page.locator('[data-post="' + a + '"] .pb-vote'),
    liveB = page.locator('[data-post="' + b + '"] .pb-vote');
  await expect(liveA).toHaveAttribute("aria-pressed", "false");
  await expect(liveA).toHaveText(String(countA));
  await expect(liveB).toHaveAttribute("aria-pressed", "true");
  await expect(liveB).toHaveText(String(countB + 1));
  await liveB.click();
  await expect(liveB).toHaveAttribute("aria-pressed", "false");
});

test("@public keeps roadmap columns mounted during overlapping searches", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  const firstCard = page.locator(".pb-road-card a").first();
  const title = await firstCard.innerText();
  const firstColumn = await page.locator(".pb-column").first().elementHandle();
  const firstWord = title.match(/[\p{L}\p{N}]+/u)![0];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const matchesFirstSearch = (url: URL) =>
    url.pathname.startsWith("/api/v1/b/") &&
    url.searchParams.get("q") === firstWord;
  await page.route(matchesFirstSearch, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Search feedback", exact: true })
    .click();
  const input = page.getByRole("searchbox");
  const pending = page.waitForRequest((r) =>
    matchesFirstSearch(new URL(r.url())),
  );
  await input.fill(firstWord);
  await pending;
  try {
    expect(await firstColumn!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(firstCard).toHaveText(title);
    await input.fill("zzzznomatchingfeedback");
    await expect(page.locator(".pb-road-card")).toHaveCount(0);
    await expect(page.locator(".pb-col-count")).toHaveText(Array(6).fill("0"));
  } finally {
    release();
  }
  expect(await firstColumn!.evaluate((node) => node.isConnected)).toBe(true);
  await input.fill("");
  await expect(firstCard).toHaveText(title);
  await expect(input).toBeFocused();
});

test("@compose guest submits, comments, replies, edits and retracts a like", async ({
  page,
}) => {
  const title = "Browser feedback " + randomUUID().slice(0, 8);
  await page.getByRole("button", { name: "New post", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("Your name (optional)").fill("River");
  await modal.getByLabel("Title", { exact: true }).fill(title);
  await modal
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A trail report from the mobile app.");
  await modal.getByRole("button", { name: "Submit feedback" }).click();
  await expect(modal).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search feedback", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "Search feedback" }).fill(title);
  const link = page.getByRole("link", { name: title, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "Write a comment…" }).click();
  const name = modal.getByLabel("Your name (optional)");
  await expect(name).toHaveValue("River");
  await name.fill("River Scout");
  const editor = modal.getByRole("textbox", { name: "Write a comment" });
  await editor.fill("An idea from our group.");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await expect(editor).toHaveText("An idea from our group.");
  await modal.getByRole("button", { name: "Comment", exact: true }).click();
  const comment = modal.locator(".pb-comment").first();
  await expect(comment).toContainText("An idea from our group.");
  await expect(comment.locator(".pb-byline b")).toHaveText("River Scout");
  await expect(comment.locator(".pb-team")).toHaveCount(0);
  await comment.getByRole("button", { name: "Like", exact: true }).click();
  await expect(
    comment.getByRole("button", { name: "Remove like" }),
  ).toHaveAttribute("aria-pressed", "true");
  await comment.getByRole("button", { name: "Remove like" }).click();
  await comment.getByRole("button", { name: "Reply", exact: true }).click();
  await modal
    .getByRole("textbox", { name: "Write a reply" })
    .fill("Thanks for trying it.");
  await modal.getByRole("button", { name: "Post reply" }).click();
  await expect(modal.locator(".pb-reply")).toContainText(
    "Thanks for trying it.",
  );
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  await comment
    .getByRole("textbox", { name: "Write a comment" })
    .fill("Revised after our trip.");
  await comment.getByRole("button", { name: "Save changes" }).click();
  await expect(comment).toContainText("Revised after our trip.");
  await comment.getByRole("button", { name: "Delete", exact: true }).click();
  await comment.locator(".pb-danger").click();
  await expect(comment).toContainText("This comment was deleted.");
  await modal
    .locator(".pb-detail-actions")
    .getByRole("button", { name: "Delete" })
    .click();
  await modal.locator(".pb-confirm .pb-danger").click();
  await expect(modal).toHaveCount(0);
  await expect(link).toHaveCount(0);
});

test("@public roadmap, published update snapshots, subscription, locale and guest recovery", async ({
  page,
  browser,
}) => {
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  await expect(page.locator(".pb-column")).toHaveCount(6);
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await expect(page.locator(".pb-update a").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Subscribe to updates" })
    .last()
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Email address")
    .fill("board-" + randomUUID().slice(0, 12) + "@example.test");
  await modal.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(modal).toContainText("Check your inbox");
  await modal.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Guest profile" }).click();
  await modal.getByLabel("Display name").fill("Rui");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await modal.getByRole("button", { name: "Get recovery code" }).click();
  const code = await modal.locator("code").innerText();
  expect(code.length).toBeGreaterThan(15);
  await modal.getByRole("button", { name: "Close" }).click();
  const second = await browser.newContext();
  try {
    const recovered = await second.newPage();
    await recovered.goto(new URL(path + "#recover=" + code, page.url()).href);
    await expect(
      recovered.getByLabel("Recovery code", { exact: true }),
    ).toHaveValue(code);
    expect(new URL(recovered.url()).hash).toBe("");
    await recovered
      .getByRole("button", { name: "Restore identity", exact: true })
      .click();
    await expect(recovered.getByRole("dialog")).toHaveCount(0);
    await recovered.getByRole("button", { name: "Guest profile" }).click();
    await expect(recovered.getByLabel("Display name")).toHaveValue("Rui");
  } finally {
    await second.close();
  }
  await page.getByRole("button", { name: "Language" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", /pt/);
  await expect(
    page.getByRole("button", { name: "Atualizações", exact: true }),
  ).toBeVisible();
});

test("@public fits six roadmap columns on desktop and shares the discussion from a card", async ({
  page,
  context,
}) => {
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  const roadmap = page.locator(".pb-roadmap");
  await expect(roadmap.locator(".pb-column")).toHaveCount(6);
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 740 });
    const overflow = await roadmap.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    const header = (await page.locator(".pb-hero").boundingBox())!;
    const toolbar = (await page.locator(".pb-navrow").boundingBox())!;
    const columns = (await roadmap.boundingBox())!;
    expect(header.x + header.width / 2).toBeCloseTo(
      columns.x + columns.width / 2,
    );
    expect(toolbar.x).toBe(header.x);
    expect(toolbar.width).toBe(header.width);
    expect(header.width).toBe(width === 390 ? columns.width : 640);
    if (width === 390) expect(overflow).toBeGreaterThan(0);
    else expect(overflow).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }
  const card = roadmap.locator(".pb-card").first();
  const link = card.getByRole("link");
  const title = await link.innerText();
  const url = new URL((await link.getAttribute("href"))!, page.url()).href;
  await card.click({ position: { x: 5, y: 5 } });
  const header = page.getByRole("dialog").locator("header");
  await expect(header.getByRole("heading")).toHaveText(title);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await header.getByRole("button", { name: "Copy link" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(url);
  const shared = await context.newPage();
  await shared.goto(url);
  await expect(
    shared
      .getByRole("dialog")
      .getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await shared.close();
});

test("@public keeps long columns and thread DOM bounded as pages accumulate", async ({
  page,
}) => {
  const card = page.locator(".pb-card").first();
  await card.locator("a").click();
  const dialog = page.getByRole("dialog");
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    const result = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("/posts/") &&
        r.url().includes("cursor="),
    );
    await dialog.getByRole("button", { name: "Load more" }).click();
    await result;
  }
  const thread = dialog.getByRole("list", { name: "Comments" });
  await expect(thread.locator(".pb-virtual-inner")).toHaveCount(1);
  expect(await thread.locator(".pb-comment").count()).toBeLessThan(40);
  const header = dialog.locator(".pb-modal-header");
  const author = dialog.locator(".pb-detail-summary .pb-byline");
  const footer = dialog.locator(".pb-comment-footer");
  const scroll = dialog.locator(".pb-detail-scroll");
  const fixed = () =>
    Promise.all([header, author, footer].map((el) => el.boundingBox()));
  const positions = await fixed();
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await fixed()).toEqual(positions);
  await expect(thread.locator("[aria-posinset]").last()).toHaveAttribute(
    "aria-posinset",
    (await thread
      .locator("[aria-setsize]")
      .first()
      .getAttribute("aria-setsize"))!,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  const column = page.locator(".pb-column").first();
  for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
    const result = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("cursor=") &&
        r.url().includes("status="),
    );
    await column.getByRole("button", { name: "Load more" }).click();
    await result;
  }
  await expect(column.locator(".pb-virtual-inner")).toHaveCount(1);
  expect(await column.locator(".pb-card").count()).toBeLessThan(40);
});

test("@compose serialized Markdown survives a server round trip with managed media", async ({
  page,
}) => {
  const title = "Markup " + randomUUID().slice(0, 8);
  await page.getByRole("button", { name: "New post", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Title", { exact: true }).fill(title);
  const editor = modal.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await editor.click();
  await modal.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.type("Important");
  await modal.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Trail conditions");
  await page.keyboard.press("Enter");
  await modal.getByRole("button", { name: "Table", exact: true }).click();
  await page.keyboard.type("Park");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await modal
    .locator("input[type=file]")
    .setInputFiles({ name: "trail.png", mimeType: "image/png", buffer: bytes });
  await expect(modal.locator(".pb-thumbs img")).toHaveCount(1);
  await modal.getByRole("button", { name: "Submit feedback" }).click();
  await expect(modal).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search feedback", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "Search feedback" }).fill(title);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(modal.locator(".pb-prose strong").first()).toHaveText(
    "Important",
  );
  await expect(modal.locator(".pb-prose table")).toHaveCount(1);
  await expect(modal.locator(".pb-detail-media img")).toHaveCount(1);
  await modal.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Edit feedback" }) });
  await expect(edit.locator(".pb-editor table")).toHaveCount(1);
  await expect(edit.locator(".pb-editor h2")).toHaveText("Trail conditions");
  await edit.getByRole("button", { name: "Remove image" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(modal.locator(".pb-detail-media img")).toHaveCount(0);
  await modal
    .locator(".pb-detail-actions")
    .getByRole("button", { name: "Delete" })
    .click();
  await modal.locator(".pb-confirm .pb-danger").click();
  await expect(modal).toHaveCount(0);
});

test("@updates loads older announcements independently of feedback pagination", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  const updates = page.locator(".pb-update");
  await expect(updates).toHaveCount(30);
  const response = page.waitForResponse(
    (r) => r.url().includes("/updates?") && r.ok(),
  );
  await page.getByRole("button", { name: "Load more" }).click();
  await response;
  await expect(updates).toHaveCount(35);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("@performance typing a comment does not rerender board cards", async ({
  page,
}) => {
  const check = await profileComponent(page, '"pb-road-card"');
  await page.reload();
  await page.locator(".pb-card a").first().click();
  await page.getByRole("button", { name: "Write a comment…" }).click();
  const editor = page.getByRole("textbox", { name: "Write a comment" });
  await editor.click();
  await check(() => editor.pressSequentially("Please add this feature."));
});

test("@public combines tag and status filters and restores shared selections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  const popup = page.getByRole("dialog", { name: "Filters" });
  const rect = await popup.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await popup.getByLabel("Feature", { exact: true }).check();
  await popup.getByLabel("Bug", { exact: true }).check();
  await popup.locator("summary").click();
  await popup.getByLabel("Planned", { exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(trigger).toHaveText("3");
  const column = page.locator(".pb-column");
  await expect(column).toHaveCount(1);
  await expect(column.locator(".pb-col-head")).toContainText("Planned");
  const tags = column.locator(".pb-card .pb-chip");
  await expect(tags.first()).toBeVisible();
  expect([...new Set(await tags.allTextContents())].sort()).toEqual([
    "Bug",
    "Feature",
  ]);
  await page.reload();
  await expect(trigger).toHaveText("3");
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "Remove filter · Bug" }).click();
  await expect(trigger).toHaveText("2");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .first()
    .click();
  await expect(column).toHaveCount(6);
  await expect(page.locator(".pb-filter-chips")).toHaveCount(0);
});
