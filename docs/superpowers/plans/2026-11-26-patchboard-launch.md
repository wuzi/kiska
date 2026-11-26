# PatchBoard implementation plan

> **For implementers** — Read the [launch specification](../../spec.md) first. This is a plan for review. After approval to build, use the team's chosen execution workflow (Superpowers Executing Plans or Subagent-Driven Development) and track the checkboxes task by task.

**Goal** — Deliver a free multi-organization, multi-board feedback service that a VPS operator can deploy and restore, and that players and creators can use within the agreed interaction budgets.

**Architecture** — Axum owns authorization, the REST API, public HTML, and same-origin asset delivery for the application. SQLx uses PostgreSQL for the application model, sessions, and durable jobs. A worker from the same release image delivers SMTP mail and performs storage cleanup. Private SeaweedFS handles uploaded media. React uses separate public and workspace entries built by Vite, shadcn/ui controls, TanStack Query, and TanStack Virtual.

**Starting point** — The repository contains a README and `assets/icon.svg`. All implementation paths, commands, defaults, and test fixtures below are proposed additions. The product behaviors and budgets in the specification are approved.

## Global constraints

- Fresh installation. A board belongs to exactly one organization. Owners, admins, and moderators have organization-wide staff roles.
- Public path `/b/{organization-slug}/{board-slug}`. Public HTML and metadata obey the same visibility rules as the JSON API.
- English and Brazilian Portuguese UI. Browser locale with remembered manual override. One authored value per field.
- 3 owned organizations per creator. Per organization, 10 boards, 10 teammates including the owner, and 250 MiB of media. At most 4 images per post and 5 MiB per input.
- 30-day board and organization recovery. At most 5 minutes for previously issued published-image links. New private image requests check current authorization.
- Separate public mobile and creator desktop budgets. Cold LCP ≤2.5 s at p75 and warm interactions ≤100 ms at p95. Use 10,000 posts and a 1,000-comment thread.
- The default production Compose stack includes PostgreSQL and private SeaweedFS on the VPS. Queue mail for an operator-configured SMTP relay.

## Review focus

1. One person manages organization A and visits organization B as a guest. Switching organizations must not reuse staff grants, cached details, guest avatars, or private images. Exercise in tasks 3, 6, 8, and 10.
2. Two concurrent requests race for the final seat, board, or available media bytes. The durable count must stay within the effective allowance even when one request retries. Exercise in tasks 3, 4, and 8.
3. A moderator hides a popular post while its dialog, share preview, and attachment URL are open elsewhere. All fresh public reads must observe visibility and only an existing signed URL gets its remaining lifetime. Exercise in tasks 8, 10, and 11.
4. A user votes twice quickly or two admins save conflicting edits. A failed or stale request must preserve later successful writes, other cards, and the editor's local draft. Exercise in tasks 5, 9, 10, and 13.
5. A worker stops after an external side effect. Retrying publication, delivery, upload finalization, or purge must preserve the database/object relationship and avoid creating a second logical event. Exercise in tasks 8, 12, 15, and 16.

## Repository layout and contracts

| Proposed path | Responsibility |
| --- | --- |
| `Cargo.toml`, `server/Cargo.toml`, `server/src/main.rs` | Rust workspace and the `patchboard` binary with `serve`, `worker`, `migrate`, `openapi`, and explicit operator provisioning commands. |
| `server/src/{accounts,organizations,boards,guests,posts,media,moderation,updates,mail,operations}/` | Domain-specific routes, transactions, authorization calls, and JSON types. SQL migrations live in `server/migrations/`. |
| `server/src/public/`, `server/templates/` | Public view models and escaped HTML. A public API and its template use the same visibility query and pagination rules. |
| `web/src/{public,workspace,operator}/`, `web/src/ui/` | Route entries, forms, board surfaces, and shared presentation components. `web/src/api/generated.ts` holds generated types. |
| `server/tests/acceptance.rs`, `server/tests/cases/`, `web/e2e/`, `web/perf/` | Real PostgreSQL/API cases, browser journeys, and repeatable production-build measurements. |
| `Dockerfile`, `ops/Dockerfile`, `compose.yaml`, `compose.dev.yaml`, `ops/` | Multistage app/worker image including built frontend, backup/restore tool image, production stack, dev inbox, and operator instructions. |

**Public contracts**

- Scope public endpoints under `/api/v1/b/{org}/{board}` and staff operations under `/api/v1/orgs/{org_id}/boards/{board_id}`. Use global account routes under `/api/v1/account` and separately authorized instance routes under `/api/v1/operator`. Post links append `/p/{post_id}-{slug}` to the public board path. Stable IDs identify objects and slugs make links readable.
- Resolve staff actions with `require_board(actor, org_id, board_id, action) -> BoardAccess`. Use tenant-aware keys and foreign keys so a post, tag, status, upload, or merge destination cannot be attached to a different board. Common public-query inputs include board, viewer, locale, filters, order, and cursor. Return `items` and `next_cursor` with counts of content visible to that viewer.
- Votes and likes use desired-state writes (PUT to set, DELETE to clear). Mutable settings and staff edits carry an expected `revision`. Return a structured error with a stable `code` and optional `fields` for localized UI. A stale revision yields HTTP 409. A hidden resource requested without access yields 404. The browser retains the user's pending edit.
- Use `utoipa-axum` to export the registered API and `openapi-typescript` to generate client types. CI regenerates the contract and fails on drift. Keep database rows, public DTOs, and staff-only fields distinct. [Axum OpenAPI integration](https://docs.rs/utoipa-axum/latest/utoipa_axum/) · [TypeScript client](https://openapi-ts.dev/openapi-fetch/)

**Proposed defaults for review** — Carry forward the Go limits of 3–120 characters for a post title, 10,000 for a post or Update body, 5,000 for a comment or team response, and 40 for a display name. Start with 30 items per list page (maximum 50) and page long roadmap columns independently. Start with a 7-day invitation and a 30-day staff session, rate-limited login/recovery, and Argon2id password hashes. Use secure host-only cookies in production and CSRF protection for state-changing browser requests. Provide one fixed, versioned DiceBear style using an opaque seed. Changing names leaves seeds intact. These defaults and the benchmark profiles below are reviewable without reopening the launch scope.

**Database invariants**

| Relationship | Constraint or transaction to exercise |
| --- | --- |
| Accounts, org memberships, invitations | Unique membership per account and organization. Atomic ownership transfer leaves exactly one owner. Unexpired seat reservations and accepted memberships together obey the effective seat limit. |
| Boards, folders, personal pins, aliases | Scope folders and board names used in URLs to their organization. Scope pins to the teammate and board. Reserve old URL slugs after renames so a later board cannot claim another community's shared links. |
| Post, status, tag, comment, guest | A status/tag assignment and a comment's parent must agree with its board/post respectively. One guest identity belongs to one organization. Enforce one vote per guest/post and one like per guest/comment. |
| Board configuration and live content | Version saved configuration separately from ordinary votes and comments. A new vote must not force a settings-save conflict. Store a preset translation key or literal label plus color in each Update status snapshot. |
| Media and quota | Give every upload a tenant, uploader, purpose, object key, and lifecycle state. Reserve and settle bytes under the organization's quota lock. Record cleanup durably and reconcile staged or orphaned keys on retry. |
| Publication and delivery | Uniqueness on the publication operation and recipient/event pair prevents duplicate logical mailings. An active, verified subscription belongs to exactly one board and locale preference. |

## Delivery sequence

The task order is a viable single-engineer sequence. Each task names the files to create or extend and a testable interface. Start each task with its named acceptance case, run it against the existing implementation, then implement and rerun the same case. For Rust cases use `cargo test -p patchboard --test acceptance <case_name>`. For a browser tag use `npm --prefix web run e2e -- --grep @tag`. The commands and test harness are introduced in task 1. A passing task produces a reviewable increment.

### 1. Boot a fresh application and establish the API contract

**Files** — `Cargo.toml`, `server/src/{main,app,config}.rs`, `server/migrations/`, `server/tests/{acceptance.rs,cases/boot.rs}`, `web/package.json`, `web/vite.config.ts`, `web/playwright.config.ts`, `web/src/api/`, `Makefile`, `compose.yaml` (PostgreSQL service).

- [ ] In `fresh_boot`, migrate an empty PostgreSQL database twice, start Axum, request `/healthz` and `/readyz`, then disconnect PostgreSQL. Liveness stays healthy and readiness fails. Add a browser smoke test that loads a built entrypoint.
- [ ] Implement `build_router(state: AppState) -> Router`, CLI mode dispatch, isolated test database setup/teardown, controllable clock, two Vite entries, and stable test scripts. Make `patchboard openapi` export from the same route registrations without needing a live production configuration.
- [ ] Run `fresh_boot`, `make check-contract`, and the browser smoke case. Deliberately change a response schema in the test checkout and verify the drift check fails until generated types are refreshed. Check SQLx offline build metadata against the migrated test schema when using checked queries.

### 2. Register and recover a creator through the development inbox

**Files** — `server/src/accounts/`, `server/src/mail/{outbox,worker,smtp}.rs`, `server/tests/cases/accounts.rs`, `web/src/workspace/account/`, `web/e2e/accounts.spec.ts`, `compose.dev.yaml`.

- [ ] In `account_lifecycle` and `@account`, register, verify once, sign in, change display name, verify a different notification address, reset password, and sign out. Assert the old password fails, a reused token fails, and the new notification address does not change the login address.
- [ ] Implement private session lookup, hashed single-use tokens with expiry, password hashing, throttled login/reset, and token consumption only on confirmed actions. Insert the account event and outbox row in one transaction. SMTP failure after registration leaves an event the worker can retry. Existing verified accounts can sign in while mail is unavailable.
- [ ] Run the named cases against real PostgreSQL and a development SMTP inbox. Inspect the actual received links and their destination after expiry, including responses that avoid disclosing whether a reset address exists.

### 3. Establish tenant boundaries, invitations, and ownership

**Files** — `server/src/organizations/{membership,access,invites}.rs`, `server/tests/cases/organizations.rs`, `web/src/workspace/organizations/`, `web/e2e/organizations.spec.ts`.

- [ ] In `organization_access` and `@organizations`, require email verification before organization creation. A verified creator can create three. Two creates racing for the last allowance produce one success. A user who is admin in A and moderator in B gets the appropriate capabilities in each.
- [ ] Create organizations, verified-email invitations, memberships, the organization switcher, role management, and atomic ownership transfer. Lock the relevant quota owner when consuming a seat or ownership slot. Reserve one seat per outstanding email invitation, release it on expiry/revocation, and convert the reservation into membership on acceptance. Reissuing an invite replaces the token and reuses its seat.
- [ ] Run the cases with two organizations, expired and wrong-email invites, concurrent last-seat claims, a transfer to an owner at capacity, and a removed teammate with an existing session. Check the API and the workspace controls.

### 4. Create boards, organize the workspace, and publish links

**Files** — `server/src/boards/{lifecycle,folders,links}.rs`, `server/tests/cases/boards.rs`, `web/src/workspace/home/`, `web/e2e/workspace.spec.ts`.

- [ ] In `board_lifecycle` and `@workspace`, draft a board, publish, rename it, move it to a shared folder, and pin it. A second teammate sees the folder order and keeps their own pins. The original URL resolves to the same published board.
- [ ] Implement board creation with the ten-board limit, unique scoped slugs with reserved aliases, independent publication/suspension/closure state, and stable canonical redirects. Build the sidebar, switches, home search/filter, counts, folder creation and reordering, pin controls, and the copy-link action. Use the existing repository icon where appropriate.
- [ ] Run the cases for two boards with the same slug in different organizations, conflicting renames within one organization, racing for board ten, and direct access to a draft or its aliases. Confirm a moderator can navigate boards but cannot publish one.

### 5. Configure board language, workflow, and settings transactions

**Files** — `server/src/boards/{settings,taxonomy,locale}.rs`, `web/src/i18n/`, `web/src/workspace/board/settings/`, `server/tests/cases/settings.rs`, `web/e2e/settings.spec.ts`.

- [ ] In `settings_revision` and `@settings`, assert that `pt-BR` resolves a preset to “Planejado”, the English switch renders “Planned”, and renaming once to “Next patch” renders that literal in both locales. Set different board and form visibility values and reload them.
- [ ] Store preset keys and optional custom labels, status colors/order, one protected default, allowed visitor destinations, tags, and validated board settings. Persist locale override for both server HTML and React. Deleting a non-default status requires a same-board replacement in the same transaction. Tag removal clears references. Wire the Settings controls enumerated in the specification.
- [ ] Submit two Saves against the same revision and assert one 409 with the losing editor's draft intact. Reject a replacement status from another board and an indexing change by anyone below owner. Keep a valid destination when visitor posting is enabled. Run both named cases, extending the status reassignment assertions with real posts in task 7.

### 6. Give each organization its own recoverable guest identity

**Files** — `server/src/guests/{identity,recovery,avatar,limits}.rs`, `web/src/public/profile/`, `server/tests/cases/guests.rs`.

- [ ] In `guest_scope`, verify that reading a public page with the browser leaves the guest count unchanged. The first action creates one. Two boards in A resolve the same guest and avatar, while a board in B resolves a different identity. Renaming preserves the avatar. Recovering A in another browser restores A alone.
- [ ] Implement an organization-scoped guest grant and explicit recovery exchange. Keep recovery credentials out of logs, referrers, cached responses, and share URLs. Use the native DiceBear renderer with a pinned style/version and immutable avatar URLs. Staff authorship is established by membership on the current board. Voting uses the same organization guest identity even after staff sign-in.
- [ ] Run `guest_scope` with parallel first actions from an established browser session, guest-name edits, a copied recovery link, and rate-limit tests. Check trusted-proxy handling and tenant-scoped keyed IP signals. Use configurable, bounded throttles on identities, signup, posting, comments, votes, likes, uploads, and mail-triggering endpoints.

### 7. Create feedback, rich text, and threaded discussion

**Files** — `server/src/posts/{write,comments,content}.rs`, `web/src/public/composer/`, `server/tests/cases/feedback.rs`, `web/e2e/feedback.spec.ts`.

- [ ] In `feedback_rules` and `@compose`, submit from an enabled roadmap column, create a pending post, and compare author, staff, and unrelated visitor responses. Reject direct API calls from a guest posting to a team-only board or a disallowed destination.
- [ ] Implement post and comment writes, author edit/delete rules, reply rooting, comment likes, lock enforcement, and a lazy-loaded inline editor. Persist Markdown using a tested serializer for the editor's supported formatting. Render and sanitize it on the server. Validate limits on normalized content and keep user input on validation/network failures.
- [ ] Verify bold/italic/link/list shortcuts, headings/code/quotes/tables/strikethrough round trips, oldest-first replies, deletion placeholders, no raw HTML or untracked remote images, and accurate visible counts. Run the named cases and task 5's reassignment case with posts in the old status.

### 8. Store and account for private media on the VPS

**Files** — `server/src/media/{store,process,quota,delivery}.rs`, `server/tests/cases/media.rs`, `web/src/ui/uploads/`, `compose.yaml`, `ops/storage/`.

- [ ] Add `media_visibility` against actual private SeaweedFS. Upload as a guest, authorize a private preview, change the fixture to published, request a signed image through the public origin, then hide the fixture. New public grants fail immediately. The original grant expires within 300 seconds. An unrelated guest cannot read a pending image even when they know its ID. Repeat these transitions through the moderation API in task 11.
- [ ] Validate actual image bytes, decoded pixel limits, and file count. Carry forward a 40-megapixel input bound and resize to at most 2,560 px on the longest side. Strip metadata and produce bounded output. Stage uploads privately and bind them to organization, board, and uploader. Use immutable object keys, reserve capacity atomically before each durable write, finalize actual usage once, and reclaim abandoned staging after 24 hours. Include logos, covers, and derivatives.
- [ ] For published media issue a short-lived GET redirect after a visibility check. Set cache policy on grants and delivered media so a shared cache cannot extend access beyond the five-minute grant. Proxy private reads with per-request authorization and private/no-store headers. Keep the signed origin, Host, path, and query valid through TLS. Test fresh direct reads, expiry with the storage server's real clock (a short test TTL), retries after storage failure, concurrent claims for remaining bytes, and cross-board attachment claims. Check text-only submissions still succeed at quota.

### 9. Rank, filter, and vote on populated boards

**Files** — `server/src/posts/{votes,discovery,roadmap}.rs`, `server/tests/cases/discovery.rs`, `web/src/api/queries.ts`.

- [ ] In `discovery_and_votes`, assert that double PUT produces one vote, double DELETE leaves zero, and posting never self-votes. Use clock-controlled data on both sides of the seven-day boundary. Assert pinned/trending/top/new results, status/manual ordering, and distinct weekly indicators.
- [ ] Implement board-scoped full-text prefix search with accent normalization, filterable summaries, independently paginated roadmap columns, per-viewer vote state, recent avatars, visible totals, and up to five duplicate suggestions. Use a stable ID tie-breaker for pagination. Index board/status/time and vote/search lookups on the fixture. Share query keys across list, roadmap, and detail, including tenant, locale, and viewer as needed.
- [ ] Run `discovery_and_votes` with repeated timestamps, an empty column, more than 100 cards in one status, and private or merged candidates. Paging a static result set must exhaust it once. Compare counts, suggestions, and search visibility across the two boards.

### 10. Serve readable public HTML and fast interactive views

**Files** — `server/src/public/`, `server/templates/`, `web/src/public/{board,roadmap,post}/`, `server/tests/cases/public_html.rs`, `web/e2e/public.spec.ts`.

- [ ] In `public_html` and `@public`, use a plain HTTP GET for a localized board and shared post. Assert meaningful content, canonical URL, robots policy, and visible-only Open Graph metadata. With JavaScript enabled, hold the details response and click a card. The correct title, status, and vote must paint before the held response completes.
- [ ] Use the discovery read model for HTML and initial JSON. Escape bootstrap data and preserve initial content as React takes over. Ship the small public entry, dialog shell, and CSS independently of the workspace and rich editor. Use the cached summary as placeholder data until detail arrives. Implement List/Roadmap, shared detail dialog, comment composer, navigation history, and focus restoration with a fallback when the original card was virtualized away.
- [ ] In TanStack Query `onMutate`, update the same entity across the visible list, roadmap, and dialog. Carry an operation-specific inverse patch or serialize overlapping writes for that entity. On a definitive failure, revert that operation only. On a timeout with unknown outcome, reconcile with the server's desired-state endpoint before showing a final result. Apply this pattern to quick edits and moves in task 11.
- [ ] Page server results and use `@tanstack/react-virtual` for unbounded mounted rows and cards within columns, comment feeds, and long option lists. Use transform/opacity motion and a reduced-motion path. Keep drafts independent of query refresh. Revalidate on focus and about every 30 seconds while visible. Run the named cases with a failed vote on A while B succeeds, a delayed response after a tenant switch, Back/Forward, keyboard navigation, and a typed draft surviving a background fetch.

### 11. Moderate live boards and maintain vote integrity

**Files** — `server/src/moderation/{queue,actions,merge,bans,audit}.rs`, `web/src/workspace/moderation/`, `server/tests/cases/moderation.rs`, `web/e2e/moderation.spec.ts`.

- [ ] In `moderation_scope` and `@moderate`, approve a pending suggestion, drag it to another status or use the keyboard action, attach a team response, pin/lock it, hide then restore it. Check role enforcement through the API and the public result through the browser.
- [ ] Implement post/comment edit, trash/restore, image removal, and vote audit/removal. Merge duplicates in one same-board transaction. Deduplicate voters, reparent comments, preserve the survivor, and resolve old links through visibility checks. Add board bans (including optional IP-hash bans) and owner/admin organization extensions. Expose only authorized audit data.
- [ ] Run the cases with overlapping voters, competing merge requests, attempts to create a merge cycle, held image links, and a banned guest visiting a sibling board before/after an organization-wide ban. A moderator can respond to a status move and must receive a permission error when attempting to publish an Update.

### 12. Publish Updates and deliver opt-in email

**Files** — `server/src/updates/{publish,subscriptions}.rs`, `server/src/mail/`, `web/src/public/updates/`, `web/src/workspace/updates/`, `server/tests/cases/announcements.rs`, `web/e2e/updates.spec.ts`.

- [ ] In `publish_once` and `@updates`, confirm a subscription in the local inbox, publish an announcement linking a post, change the post's status, and check the publication-time label/color in both UI languages. Test a standalone announcement and explicit publication together with a status move.
- [ ] Commit status change, optional team response, Update, status snapshots, and durable event atomically when submitted together. Use a client operation ID for publication retries and a unique event/recipient delivery key. Create/edit/delete independent Updates with up to ten same-board linked posts. Recheck each linked post's visibility before emitting its title or link publicly.
- [ ] Confirm board-specific double opt-in, locale, one-click unsubscribe, verified staff notification addresses, separate staff submission opt-in, and suppression for a closed/suspended board. Retrying the publish request, editing an Update, or previewing one must not enqueue another announcement. Exercise worker restarts and SMTP outages. Deduplicate logical jobs and use a stable Message-ID. Document the remaining ambiguity when a remote relay accepts a message and the connection drops before acknowledgement.

### 13. Complete the reference editor, theme controls, and disposable preview

**Files** — `web/src/workspace/board/{editor,customize,preview}/`, `web/src/ui/board-theme/`, `server/src/boards/appearance.rs`, `web/e2e/editor.spec.ts`.

- [ ] In `@editor`, open Settings or Customize from a populated board with the network delayed, type a title, change a color, preview at three device widths, submit and vote in Preview, reset Preview, then Save and visit the published URL in another browser.
- [ ] Share the public presentation components and validated theme settings with the editor. Implement logo/cover/link editing and all color, type, width, shape, input, and button controls from the specification. Scope theme variables to the board. Keep form state within the panel. Present Save, stale-edit recovery, appearance reset, and copy-link feedback. Keep uncommitted configuration distinct from immediate live moderation actions.
- [ ] Use an isolated in-memory preview data adapter for simulated writes and local temporary image previews. Assert zero live mutation requests, uploaded bytes, mail events, or persisted simulated votes. Verify Start over, cancel, save/reopen, and editor controls on narrow screens. Keyboard focus and pointer interaction must return to the board when a panel closes.

### 14. Display free usage and operate suspensions

**Files** — `server/src/operations/{limits,operator,audit}.rs`, `web/src/operator/`, `web/src/workspace/account/Usage.tsx`, `server/tests/cases/operations.rs`, `web/e2e/operator.spec.ts`.

- [ ] In `operator_controls` and `@operator`, fill a media allowance, lower an override below current usage, then raise it. The account screen shows actual usage for the selected organization. Writes that increase over-limit usage fail, while removal, ordinary votes, and text-only posts succeed.
- [ ] Implement audited, reasoned overrides and suspension/restore controls for both boards and organizations. Provision the instance operator explicitly outside public signup. Include free-plan usage, support/policy destinations, and account controls from the reference. Separate global limits, tenant overrides, membership roles, and instance authority.
- [ ] Exercise suspension via public HTML, JSON, alias, search, OG, fresh image grant, and queued notification paths. Restoring an organization preserves any separate board suspension. Check that a regular owner cannot access operator data by calling its API directly.

### 15. Close, restore, and purge without orphaning an organization

**Files** — `server/src/operations/{closure,purge}.rs`, `server/src/accounts/closure.rs`, `web/src/workspace/account/closure/`, `server/tests/cases/closure.rs`, `web/e2e/closure.spec.ts`.

- [ ] In `closure_window` and `@closure`, exercise deletion by an owner who transfers one organization and explicitly closes a second. The transferred organization keeps its data and owner. Only the closed organization disappears. Exercise recovery through the verified owner's email during the grace period.
- [ ] Model suspension, closure timestamp, purge eligibility, and account recovery separately. Revoke ordinary sessions on account closure. Count recoverable resources against limits. A restore racing with purge must have one consistent result. Record object deletion work durably before removing the last database reference and retry safely until completion.
- [ ] Test immediately before and at the 30-day deadline with a controlled clock. Simulate a failed object deletion and worker restart, a board independently closed before its parent, and an owner who lacks authority after transferring ownership. Verify eventual removal of the expired objects and usage entries.

### 16. Package the VPS deployment and rehearse disaster recovery

**Files** — `Dockerfile`, `ops/Dockerfile`, `compose.yaml`, `compose.dev.yaml`, `.env.example`, `ops/{proxy,backup,restore}/`, `README.md`, `ops/tests/compose-smoke.sh`.

- [ ] Build the Vite assets and Rust service in a multistage Dockerfile. Ship one version-matched app/worker image including the asset manifest, templates, and SQL migrations. The ops image provides PostgreSQL backup tools and an S3 client. Pin tested service images and lock dependencies. Run migrations once before the app and worker become ready.
- [ ] Configure a persistent PostgreSQL service and a credentialed single-node SeaweedFS service with persistent data and a private bucket. Keep database, storage admin interfaces, and secrets private. Document routing the app and signed object reads through the operator's HTTPS proxy. For a single public hostname, reserve a path-style bucket prefix for signed object reads, preserving Host, path, and query. Keep internal writes on the Compose network. The dev override supplies an SMTP inbox.
- [ ] Implement `make compose-smoke` on fresh volumes. Boot, sign in, publish, deliver mail to a test inbox, upload, and follow a signed image through the public-facing proxy. Assert that an anonymous raw object request is denied. Restart on the same volumes and verify the database records, objects, and queued work.
- [ ] Implement `make restore-drill` in a separate Compose project with a test SMTP sink. Quiesce application mutations, uploads, and mutating workers, capture a PostgreSQL dump plus the matching object manifest/bytes, and resume only after the consistent capture. Document protected off-VPS transfer, configuration/secret recovery, and restore order. Restore into fresh volumes and verify guest recovery, a published post, a private pending image, object checksums, usage totals, and a sample signed download before accepting the drill.

### 17. Measure both experiences and review the reference screens

**Files** — `web/perf/{seed,profiles,interactions,cold-load,report}.*`, `web/e2e/reference.spec.ts`, `Makefile`.

- [ ] Seed an isolated database with 10,000 posts on one board, 1,000 comments on a popular post, realistic tags/statuses/avatars/images, a long roadmap column, and another organization with similar titles. Keep the seed deterministic. Run against the production image, with working HTTP, PostgreSQL, and media paths.
- [ ] Use the proposed mobile lab profile of 390 × 844 with 4× CPU throttling, 150 ms RTT and 1.6 Mbit/s downstream. Measure the desktop workspace at 1440 × 900 with native CPU, 40 ms RTT and 10 Mbit/s downstream. Pin the browser, identify the host CPU and record the throttling setup. Preserve authentication but clear browser assets/data caches for each cold desktop visit. Use a fresh browsing context for each public cold visit.
- [ ] Run `make perf`. Collect at least 30 cold navigations per route/profile and 100 warm samples per measured action. Report nearest-rank percentiles separately for board, shared post, and signed-in workspace cold visits. Measure input to the first frame showing the correct populated dialog/panel or changed vote, including a deliberately held detail request. Record the fixture, commit, build, browser, hardware, samples, and traces. Fail any individual surface over its stated budget.
- [ ] At reference desktop, tablet, and phone widths verify List, six-column Roadmap, post dialog in read/compose/typed states, Updates and bell, workspace home, Settings, Customize, Preview, Share, and Account. Check clipping, long Portuguese labels, real avatar images, mobile touch targets, keyboard focus after virtualization, and reduced motion. Use React profiling to verify typing does not rerender the underlying board. Assert bounded DOM size on long lists, roadmaps, dropdowns, and vote audit results.
- [ ] Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `make check-contract`, the frontend typecheck/build, and the full Playwright suite. Collect that output with the Compose, recovery, and per-surface performance results for release review.

## Acceptance coverage

| Scope decisions | Proof in the plan |
| --- | --- |
| Q1, Q5, Q26 — reference parity, fresh launch, rich composer | Fresh boot (1), settings (5), feedback (7), public views (9–10), moderation/Updates (11–12), editor (13), account (14), visual review (17). |
| Q2, Q9–Q11, Q24 — creator accounts, organization-wide roles, guest scope, bans | Verified account (2), membership boundaries (3), guest recovery (6), moderation (11), closure (15). |
| Q3, Q12–Q14, Q29 — public links, indexing, publication, preview, folders and personal pins | Workspace and links (4), public HTML (10), disposable preview (13), suspension (14). |
| Q4, Q8, Q22 — guest participation, browser language and preset translations | Locale and custom labels (5), guest (6), feedback/votes (7, 9), localized cold HTML (10), mail locale (12). |
| Q7, Q16, Q23, Q25 — free limits, operator controls and recovery | Atomic ownership/seat/board limits (3–4), media quota (8), usage and suspension (14), closure and purge (15). |
| Q15, Q21 — board subscriptions, staff alerts, SMTP | Durable mail and development inbox (2), publish and receive real messages (12), restart and isolated restore (16). |
| Q6, Q17, Q27–Q28 — equal budgets, fixture, readable HTML and refresh | Queries and pagination (9), network-held interactions and refresh (10), editor (13), measured budgets (17). |
| Q18–Q20 — PostgreSQL, default self-hosted S3, five-minute grants | Real storage and visibility (8), Compose startup, proxy and restore drill (16). |
| Q30 — typed client, complete local release surface | Generated contract (1), drift check and final acceptance (17). |

**Review handoff** — Review the recommended defaults, the role boundaries, and the benchmark profiles alongside the specification. Implementation begins after review.
