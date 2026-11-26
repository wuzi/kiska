import { profileComponent } from "./render-profile";
import { expect, test } from "@playwright/test";
test.use({ actionTimeout: 8000 });

test("@workspace signed-out entry and password recovery", async ({ page }) => {
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
});

import type { Page, APIRequestContext } from "@playwright/test";

async function verificationLink(
  request: APIRequestContext,
  email: string,
  flow = "verify",
) {
  const inbox = process.env.KISKA_INBOX_URL || "http://127.0.0.1:8025";
  let url = "";
  await expect
    .poll(
      async () => {
        const list = await request.get(inbox + "/api/v1/messages");
        const result = (await list.json()) as {
          messages: Array<{
            ID: string;
            Subject: string;
            To: { Address: string }[];
          }>;
        };
        const match = result.messages.find(
          (m) =>
            m.Subject.endsWith(flow) && m.To.some((r) => r.Address === email),
        );
        if (match) {
          const msg = (await (
            await request.get(inbox + "/api/v1/message/" + match.ID)
          ).json()) as { Text: string };
          url = msg.Text.match(/https?:\/\/[^\s]+/)?.[0] || "";
        }
        return Boolean(url);
      },
      {
        timeout: 20000,
        message: "verification mail for the newly registered creator",
      },
    )
    .toBeTruthy();
  return new URL(url).pathname + new URL(url).search;
}
async function createCreator(
  page: Page,
  request: APIRequestContext,
  email: string,
) {
  const password = "a-local-test-password-34";
  await page.goto("/app");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Display name").fill("Workspace owner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await page.goto(await verificationLink(request, email));
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create your workspace" }),
  ).toBeVisible();
}

test("@account @editor @moderate @updates workspace creator publishes a board and preserves a conflicted draft", async ({
  page,
  request,
  browser,
}, info) => {
  test.setTimeout(80000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const nonce = crypto.randomUUID(),
    org = "Community " + nonce.slice(0, 8),
    name = "Feature requests";
  await createCreator(page, request, "creator-" + nonce + "@example.test");
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.getByLabel("Organization name").fill(org);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create organization" })
    .click();
  const checkCanvas = await profileComponent(page, '"ws-canvas"');
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await page.getByLabel("Board title").fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1),
    board = "/api/v1/boards/" + id;
  await page.getByRole("button", { name: "Edit details" }).click();
  const description = page.getByLabel("Description", { exact: true });
  await checkCanvas(() =>
    description.pressSequentially("Tell us what to build next."),
  );
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("group", { name: "Opens on" })
    .getByRole("button", { name: "Roadmap" })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Changes saved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Add post", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Offline mode");
  await page
    .getByRole("textbox", { name: "Details", exact: true })
    .fill("Read previous conversations offline.");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  await page.getByRole("button", { name: /^Offline mode/ }).click();
  await page
    .getByLabel("Status", { exact: true })
    .selectOption({ label: "Planned" });
  await page
    .getByLabel("Team response", { exact: true })
    .fill("Included in next release.");
  await page.getByRole("button", { name: "Save status and response" }).click();
  await expect(page.getByText("Status saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await page.getByRole("button", { name: "New Update" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Offline mode is planned");
  await page
    .getByRole("textbox", { name: "Announcement", exact: true })
    .fill("An **offline** experience is on the way.");
  await page.getByRole("checkbox", { name: "Offline mode" }).check();
  await page.getByRole("button", { name: "Publish Update" }).click();
  await expect(
    page.getByRole("heading", { name: "Offline mode is planned" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Local draft survives a competing save.");
  const remote = await (await page.request.get(board)).json();
  const saved = await page.request.put(board, {
    headers: { "X-Kiska": "1" },
    data: {
      ...remote.board,
      revision: remote.revision,
      title: "Community feedback",
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Another teammate saved changes. Your draft is intact."),
  ).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Local draft survives a competing save.",
  );
  await page.getByRole("button", { name: "Reapply my edits" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Community feedback" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByLabel("Accent", { exact: true }).fill("#227755");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const simulation = page.locator(".ws-preview");
  await expect(simulation.getByText(/Preview simulation/)).toBeVisible();
  const mutations: string[] = [];
  const capture = (r: import("@playwright/test").Request) => {
    if (r.url().includes("/api/") && r.method() !== "GET")
      mutations.push(r.method() + " " + new URL(r.url()).pathname);
  };
  page.on("request", capture);
  for (const device of ["Phone", "Tablet", "Desktop"])
    await simulation.getByRole("button", { name: device, exact: true }).click();
  await simulation
    .getByRole("button", { name: "New post", exact: true })
    .first()
    .click();
  await simulation
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Simulated offline feedback");
  await simulation
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(
    simulation.getByText("Simulated offline feedback", { exact: true }).first(),
  ).toBeVisible();
  await simulation
    .getByRole("button", { name: /^Vote · Simulated offline feedback$/ })
    .click();
  await simulation.getByRole("button", { name: "Start over" }).click();
  await expect(
    simulation.getByText("Simulated offline feedback", { exact: true }),
  ).toHaveCount(0);
  await simulation.getByRole("button", { name: "Back to editor" }).click();
  page.off("request", capture);
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Publish board" }).click();
  const url = await page.getByLabel("Published URL").inputValue();
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(url);
  await expect(
    publicPage.getByRole("heading", { name: "Community feedback" }),
  ).toBeVisible();
  await expect(
    publicPage.getByText("Offline mode", { exact: true }).first(),
  ).toBeVisible();
  await visitor.close();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Roadmap", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: info.outputPath("editor-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Customize" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("editor-phone.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("@account @closure workspace verifies notification email, accepts a teammate and transfers ownership", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(90000);
  const n = crypto.randomUUID().slice(0, 8),
    email = `owner-${n}@example.test`,
    notification = `notify-${n}@example.test`,
    invited = `member-${n}@example.test`,
    org = "Creator studio " + n;
  await createCreator(page, request, email);
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await page.getByLabel("Organization name").fill(org);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create organization" })
    .click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Studio owner");
  await page
    .getByLabel("Notification email", { exact: true })
    .fill(notification);
  await page.getByRole("switch", { name: /New submission alerts/ }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await page.goto(
    await verificationLink(request, notification, "verify-notification"),
  );
  await page.getByRole("button", { name: "Confirm address" }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(
    page.getByLabel("Notification email", { exact: true }),
  ).toHaveValue(notification);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(invited);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = await verificationLink(request, invited, "invite");
  const second = await browser.newContext({ baseURL }),
    member = await second.newPage();
  await createCreator(member, request, invited);
  await member.goto(invite);
  await member.getByRole("button", { name: "Join organization" }).click();
  await expect(
    member.getByRole("heading", { name: "Your boards" }),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: "Create board", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Manage Workspace owner" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Invite", exact: true }),
  ).toHaveCount(0);
  await member.reload();
  await member.getByRole("link", { name: "Account", exact: true }).click();
  await member.getByRole("button", { name: "Delete account" }).click();
  await expect(
    member.getByRole("button", { name: "Confirm deletion" }),
  ).toBeDisabled();
  await member
    .getByRole("switch", { name: "Close " + org, exact: true })
    .check();
  await member
    .getByRole("switch", {
      name: "Delete my account and close the selected organizations",
    })
    .check();
  await member.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(
    member.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await member.goto(
    await verificationLink(request, invited, "recover-account"),
  );
  await member.getByRole("button", { name: "Restore account" }).click();
  await member.getByLabel("Email address", { exact: true }).fill(invited);
  await member
    .getByLabel("Password", { exact: true })
    .fill("a-local-test-password-34");
  await member.getByRole("button", { name: "Sign in", exact: true }).click();
  await member.getByRole("button", { name: "Restore organization" }).click();
  await expect(
    member.getByRole("heading", { name: "Your boards" }),
  ).toBeVisible();
  await second.close();
});

test("@operator workspace records limit changes and board suspension", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.skip(
    !process.env.KISKA_OPERATOR_EMAIL ||
      !process.env.KISKA_OPERATOR_PASSWORD,
    "Requires an explicitly provisioned instance operator on the test installation.",
  );
  test.setTimeout(60000);
  const suffix = crypto.randomUUID().slice(0, 8),
    org = `Operator test ${suffix}`,
    board = `Access control ${suffix}`;
  await createCreator(page, request, `ops-target-${suffix}@example.test`);
  const headers = { "X-Kiska": "1" };
  const owner = await (
    await page.request.post("/api/v1/organizations", {
      headers,
      data: { name: org },
    })
  ).json();
  const b = await (
    await page.request.post(`/api/v1/organizations/${owner.id}/boards`, {
      headers,
      data: { title: board },
    })
  ).json();
  expect(
    (
      await page.request.post(`/api/v1/boards/${b.id}/publish`, { headers })
    ).ok(),
  ).toBe(true);
  expect((await page.request.get("/api/v1/operator")).status()).toBe(403);
  const opContext = await browser.newContext({ baseURL }),
    op = await opContext.newPage();
  await op.goto("/app");
  await op
    .getByLabel("Email address")
    .fill(process.env.KISKA_OPERATOR_EMAIL!);
  await op
    .getByLabel("Password", { exact: true })
    .fill(process.env.KISKA_OPERATOR_PASSWORD!);
  await op.getByRole("button", { name: "Sign in", exact: true }).click();
  await op.getByRole("link", { name: "Operator", exact: true }).click();
  await op.getByRole("button", { name: "Platform defaults" }).click();
  await expect(
    op.getByRole("button", { name: "Edit default limits" }),
  ).toBeVisible();
  await op.getByRole("button", { name: "Organizations", exact: true }).click();
  await op.getByLabel("Search resources").fill(org);
  await op.getByRole("button", { name: "Manage", exact: true }).click();
  await op.getByLabel("Media allowance in bytes").fill("1000");
  await op
    .getByLabel("Reason for this change")
    .fill("Check the tenant allowance " + suffix);
  await op.getByRole("button", { name: "Apply change" }).click();
  await expect(op.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/app/orgs/${owner.id}/account`);
  await expect(page.getByText("0 B / 1000 B")).toBeVisible();
  await op.getByRole("button", { name: "Boards", exact: true }).click();
  await op.getByLabel("Search resources").fill(board);
  const publicUrl = "/b/" + owner.slug + "/" + b.slug;
  for (const [action, status] of [
    ["suspend", 404],
    ["restore", 200],
  ] as const) {
    await op.getByRole("button", { name: "Manage", exact: true }).click();
    await op.getByLabel("Action", { exact: true }).selectOption(action);
    await op
      .getByLabel("Reason for this change")
      .fill(`Verification ${action} ${suffix}`);
    await op.getByRole("button", { name: "Apply change" }).click();
    await expect(op.getByRole("dialog")).toHaveCount(0);
    expect((await request.get(publicUrl)).status()).toBe(status);
  }
  await op.getByRole("button", { name: "Audit log" }).click();
  await op.getByLabel("Search resources").fill(suffix);
  await expect(
    op.getByText(`Verification restore ${suffix}`, { exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(`/api/v1/organizations/${owner.id}/close`, {
        headers,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await op.request.post("/api/v1/operator/actions", {
        headers,
        data: {
          action: "suspend",
          target_type: "organization",
          target_id: owner.id,
          reason: "Keep the operator suspension during closure recovery",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto(`/app/orgs/${owner.id}`);
  await page.getByRole("button", { name: "Restore organization" }).click();
  await expect(
    page.getByRole("button", { name: "Restore organization" }),
  ).toHaveCount(0);
  await expect(page.getByText("This organization is suspended.")).toBeVisible();
  expect((await request.get(publicUrl)).status()).toBe(404);
  expect(
    (
      await op.request.post("/api/v1/operator/actions", {
        headers,
        data: {
          action: "restore",
          target_type: "organization",
          target_id: owner.id,
          reason: "End test suspension",
        },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.get(publicUrl)).status()).toBe(200);
  await opContext.close();
});

test("@moderate @updates conflicting staff edits preserve their original revisions and drafts", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(75000);
  const n = crypto.randomUUID().slice(0, 8),
    email = `staff-${n}@example.test`,
    headers = { "X-Kiska": "1" };
  await createCreator(page, request, email);
  const org = await (
    await page.request.post("/api/v1/organizations", {
      headers,
      data: { name: "Revision test " + n },
    })
  ).json();
  const board = await (
    await page.request.post(`/api/v1/organizations/${org.id}/boards`, {
      headers,
      data: { title: "Team review" },
    })
  ).json();
  const base = `/api/v1/boards/${board.id}`;
  const initial = await (await page.request.get(base)).json();
  const post = await (
    await page.request.post(base + "/posts", {
      headers,
      data: {
        title: "Original suggestion",
        body: "Initial content",
        status_id: initial.statuses[0].id,
      },
    })
  ).json();
  const pid = post.id || post.post.id;
  expect(
    (
      await page.request.post(`${base}/posts/${pid}/comments`, {
        headers,
        data: { body: "Original comment" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(base + "/updates", {
        headers,
        data: {
          operation_id: crypto.randomUUID(),
          title: "Original update",
          body: "Initial announcement",
          post_ids: [],
        },
      })
    ).ok(),
  ).toBe(true);
  const other = await browser.newContext({ baseURL });
  expect(
    (
      await other.request.post("/api/v1/auth/login", {
        headers,
        data: { email, password: "a-local-test-password-34" },
      })
    ).ok(),
  ).toBe(true);
  const moderate = async (action: string, fields: Record<string, unknown>) =>
    expect(
      (
        await other.request.post(base + "/moderate", {
          headers,
          data: { post_id: pid, action, ...fields },
        })
      ).ok(),
    ).toBe(true);
  await page.goto(`/app/orgs/${org.id}/boards/${board.id}`);
  await expect(
    page.getByRole("button", { name: /^Original suggestion/ }),
  ).toBeVisible();
  const detail = await (await other.request.get(`${base}/posts/${pid}`)).json();
  await moderate("edit", {
    revision: detail.post.revision,
    title: "Concurrent suggestion",
    body: "Concurrent text",
  });
  await page.getByRole("button", { name: /^Original suggestion/ }).click();
  const modal = page.getByRole("dialog");
  await modal.getByText("Edit post", { exact: true }).click();
  await modal.getByLabel("Title", { exact: true }).fill("Local post draft");
  await modal.getByRole("button", { name: "Save post" }).click();
  await expect(modal.getByRole("alert")).toContainText("Your draft is intact");
  await expect(modal.getByLabel("Title", { exact: true })).toHaveValue(
    "Local post draft",
  );
  await modal.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(modal.getByLabel("Title", { exact: true })).toHaveValue(
    "Concurrent suggestion",
  );
  await modal.getByRole("button", { name: "Discussion", exact: true }).click();
  await modal.getByRole("button", { name: "Edit", exact: true }).click();
  await modal.getByLabel("Comment text").fill("Local comment draft");
  const comment = detail.comments[0];
  await moderate("edit_comment", {
    comment_id: comment.id,
    revision: comment.revision,
    body: "Concurrent comment",
  });
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Your draft is intact");
  await expect(modal.getByLabel("Comment text")).toHaveValue(
    "Local comment draft",
  );
  await modal.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(
    modal.getByText("Concurrent comment", { exact: true }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const update = (await (await other.request.get(base + "/updates")).json())
    .updates[0];
  expect(
    (
      await other.request.patch(`${base}/updates/${update.id}`, {
        headers,
        data: {
          revision: update.revision,
          title: "Concurrent update",
          body: "A newer announcement",
          post_ids: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await modal.getByLabel("Title", { exact: true }).fill("Local Update draft");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await expect(modal.getByRole("alert")).toContainText("Your draft is intact");
  await expect(modal.getByLabel("Title", { exact: true })).toHaveValue(
    "Local Update draft",
  );
  page.once("dialog", (d) => d.accept());
  const staleDelete = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      r.url().endsWith("/updates/" + update.id),
  );
  await modal.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await staleDelete).status()).toBe(409);
  await expect(modal.getByLabel("Title", { exact: true })).toHaveValue(
    "Local Update draft",
  );
  await modal.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(
    page.getByRole("heading", { name: "Concurrent update" }),
  ).toBeVisible();
  expect((await page.request.post(base + "/publish", { headers })).ok()).toBe(
    true,
  );
  await page.goto(`/b/${org.slug}/${board.slug}#recover=test`);
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Get recovery code" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guest profile" })).toHaveCount(
    0,
  );
  await other.close();
});
