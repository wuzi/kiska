# PatchBoard launch specification

**Status** — Launch scope approved in Q30 and implemented. [Build plan](superpowers/plans/2026-11-26-patchboard-launch.md) · [Launch verification](launch-verification.md)

A community organizer can sign up for free, invite teammates, customize a feedback board, try it at phone size, and publish a link. A player following that link from Discord can immediately read a suggestion, vote, propose an improvement, or join the conversation. The release starts with fresh data. Each organization can run several boards on the same installation.

## Accounts, organizations, and access

A creator registers with email and password, verifies the login address before creating an organization, and can reset a forgotten password by email. The account page shows display name, login email, a separately verifiable notification address, and notification preferences. A creator can own or join multiple organizations and switch between them. Each board has exactly one owning organization.

| Actor | Actions |
| --- | --- |
| Visitor | Read a published board, search, follow a permanent post link, and subscribe to board Updates by confirming an email address. |
| Guest | Vote, post, comment, reply, like, manage their own eligible contributions, and recover their guest identity. Board settings and moderation decisions apply. |
| Organization moderator | Moderate submissions, posts, comments, images, and votes across the organization's boards. Move roadmap cards, add a team response, and issue board-scoped bans. |
| Organization admin | Moderator capabilities plus board creation, configuration, publishing, folder organization, publishing Updates, and extending a ban to the entire organization. |
| Organization owner | Admin capabilities plus invitations, role and membership management, ownership transfer, closure, and recovery. |
| Instance operator | Inspect usage, override free limits, and suspend or restore boards or organizations. Record the actor, target, time, reason, and change. Operator access is provisioned by the host. |

Staff permissions apply across one organization. Staff posts and comments there show a team badge and the author's display name. A role in one organization grants no authority in another. Invitations bind an organization, a role, and an email address. Acceptance requires a verified matching account and is single-use. Transferring ownership preserves an active owner and checks the recipient's ownership limit. Removing a teammate takes effect on the next authorized request.

A guest identity is created on their first action. The same guest has one optional editable name, seeded avatar, and recovery identity across boards belonging to the same organization. Another organization gets its own guest identity. Recovery in a second browser restores only the selected organization's identity. A blank name displays as Anonymous or Anônimo. A stable opaque seed and a pinned DiceBear style keep the avatar consistent through name changes. PatchBoard serves the generated image. Guest voting is browser-based and provides a participation signal, with rate limits and vote review available to staff. [DiceBear Rust integration](https://www.dicebear.com/integrations/rust/)

## Board lifecycle and public URLs

1. An owner or admin creates a draft. Staff can configure it in the workspace. Preview is a disposable simulation of the public experience.
2. Publish makes the board available at `/b/{organization-slug}/{board-slug}`. Boards are shared by URL, without a platform directory. Search engine indexing starts disabled and can be enabled in board settings by the owner. Discord and other link previews work in either setting.
3. Subsequent configuration changes take effect on **Save**. Changing the preview device or pressing **Start over** affects only the simulation. Moving a real card on the live roadmap is an immediate moderation action. A failed save or conflicting staff edit preserves the local draft for review.
4. Every post has a permanent share link. Renaming a board, changing a post title, merging a duplicate, or moving a board between workspace folders preserves existing links to visible content. Aliases resolve only when the destination is visible to that viewer.
5. Suspension or closure removes public access to the board and its posts, search results, link metadata, and new image grants. Suspension and deletion are separate states. Restoration respects the state of the parent organization and any independent board restriction.

The first public HTML response contains the board heading and first visible posts for the selected view, or the actual title and text of a directly linked post. Updates pages include published announcements. Link previews include the visible title, excerpt, and first eligible image when present. Public responses and caches must respect board, locale, visibility, and viewer-specific state. A pending post must never surface through duplicate suggestions, counts, avatars, search, redirects, or metadata shown to another guest.

## Public board and feedback

| Surface | Launch behavior |
| --- | --- |
| **List** | Search, status and tag filters, pinned posts first, trending/top/new sorts, and the creator's configured opening order and density. Trending ranks votes from the past seven days, then total votes. Search is case- and accent-insensitive and supports word prefixes. Manual order persists across visits. |
| **Roadmap** | An ordered column per enabled status, its visible total, and an empty state when applicable. Cards show title, excerpt, tag, votes, comment count, and up to three recent voter avatars. Show the weekly vote indicator from two new votes in seven days. Load additional cards in a long column while preserving scroll position. |
| **Post detail** | A card opens a linkable dialog over the current view. Direct entry renders the post from the server. Browser Back or closing a card opened in context restores the prior view, filters, scroll, and keyboard focus. Provide a share action, team responses, comments, and an expandable composer. |
| **Submission** | Required title, optional formatted body, one optional board tag, and up to four images. Suggest up to five similar visible posts while the author types. Apply configured visitor posting permissions, allowed destination statuses, field visibility, and approval rules on the server. |
| **Discussion** | WYSIWYG formatting with Markdown shortcuts, inline bold, italic, links, and ordered/unordered lists. Preserve the Go board's Markdown content features including headings, quotes, code, tables, and strikethrough. Server-render and sanitize shared content. Images are managed attachments. Replies have one level of nesting, appear oldest first, and accept retractable likes. A deleted comment with surviving replies keeps a placeholder. |
| **Updates** | Dated title and formatted body, optionally linking up to ten posts. Each link keeps its status label and color at publication. An owner or admin can publish independently or while changing a post's status. The public bell offers a board-specific email subscription. |

Votes are retractable, one per guest identity and post. Posting gives no automatic vote. A guest can edit or delete their post while it is in the default status and can edit or delete their own comments. Locking a conversation stops new comments and replies. A failed submission preserves the draft and identifies fields requiring correction.

### Moderation

Posts appear immediately by default. A board can require approval for visitor submissions. Pending content is visible to its author and authorized staff. Staff can edit, approve, hide, restore, pin, lock, remove an attachment, and merge duplicate posts within a board. Merging moves comments, combines votes once per voter, and redirects the duplicate to the surviving visible post. A status change may include a team response. An email announcement requires explicit publication of an Update by an authorized role.

The vote audit flags new guest identities and shared IP hashes and allows staff to remove votes. Use keyed hashes for abuse signals, group IPv6 addresses by /64, and honor forwarded client addresses only from configured trusted proxies. Scope an optional IP-hash ban to the board or organization selected by the authorized moderator or admin. Keep organization and board bans distinct when a post is moved between statuses or two posts are merged.

## Creator workspace and reference screens

The clean, light public board and the creator's sidebar workspace follow the supplied references. Start with the rounded cards, softly shaded roadmap columns, colored status dots, and Poppins typography shown there. The editor and public views use the same board presentation settings. Provide usable keyboard controls, visible focus, labeled icon actions, reduced-motion behavior, and layouts for desktop, tablet, and phone.

| Reference surface | Required controls and behavior |
| --- | --- |
| **Workspace home and sidebar** | Organization switcher, Home, Account, searchable/filterable board list, board creation, shared folders and ordering, drag/reorder controls with keyboard alternatives, personal pins, and post counts. Moving a board or pinning a shortcut leaves its public URL intact. |
| **Board editor** | Editable title, description, icon/logo, cover, and links. Show List, Roadmap, and Updates in context. Provide Settings, Customize, Preview, and Share. Allow staff with the appropriate role to add posts, edit columns, and change a card's status. |
| **Settings** | Opening view (List or Roadmap), roomy/compact list rows, sort and manual order, editable ordered statuses and tags, roadmap visibility, public posting or team-only posting, submission button text, approval queue, visitor destination statuses, voting toggle, guest image uploads, and independent field visibility on the board and submission form. Keep required title entry available. In a visitor-enabled column, its add button preselects that status. |
| **Customize** | Background, text, accent, and button colors. Font and small/medium/large text. Narrow/medium/wide page width and short/medium/tall covers. Logo size and circle/rounded/square shape. Outline/filled inputs. Small/medium/large inputs and buttons with square/rounded/pill corners. Reset appearance to board defaults. Preview unsaved changes before saving. |
| **Preview and share** | Desktop, tablet, and phone previews, a visible simulation notice, and Start over. Simulated posts, comments, votes, and uploads never reach live board data, usage, moderation queues, or email. Share copies the canonical published URL. |
| **Account** | Profile and email settings, free plan and storage usage for the selected organization, help/support and policy links configured by the operator, and account deletion with an explicit ownership decision. All pictured board customization is included in the free plan. |

Each board has exactly one default status. The initial sequence is Suggestions (Sugestões, gray), Under review (Em análise, purple), Planned (Planejado, blue), In progress (Em desenvolvimento, amber), Done (Concluído, green), and Declined (Recusado, red). Seed the Feature, Improvement (Melhoria), and Bug tags. Suggestions is the initial default. Removing a different status requires reassigning its posts to a valid status on the same board. The current default is protected. Removing a tag detaches it. Historical Update snapshots survive either change. When there is no column-specific choice, new submissions use the default status if eligible, otherwise the first eligible status in board order.

## Language

The first visit uses the browser language (Portuguese for `pt*`, otherwise English). A remembered manual switch takes precedence, including on a cold HTML request. Built-in statuses and tags use translated presets until renamed. Once a creator names a status **Next patch**, everyone sees **Next patch**. Each title, description, label, post, and Update is entered once and shown as written. Email interface text follows the subscriber's selected locale. An email can therefore have an English unsubscribe link and a Portuguese announcement body.

## Free limits, storage, and recovery

| Resource | Launch default |
| --- | --- |
| Owned organizations | 3 per verified creator |
| Boards and teammates | 10 boards and 10 teammates, including the owner, per organization |
| Media | 250 MiB stored per organization. Posts allow 4 images, each input at most 5 MiB. |
| Deletion recovery | 30 days for boards and organizations |
| Published image access | Private storage, with signed GET links valid for at most 5 minutes |

Enforce limits across concurrent creates, uploads, invitations/acceptances, and ownership changes. Board creation and new identities also have configurable rate limits. An operator can adjust limits and override an individual allowance. Show the creator's owned-organization count and the selected organization's board count, seats, and stored bytes against their effective limits. An action at capacity identifies which allowance it needs. Media usage covers post images, logos, covers, and stored derivatives. At the media limit, text posts and votes still work. Suspended and recoverable resources continue to occupy their allowances.

The default production Docker Compose stack runs Axum, PostgreSQL, and private SeaweedFS on one VPS. PostgreSQL holds application data and object references. S3-compatible storage holds uploaded image bytes. Validate the image, limit decoded size, re-encode, strip metadata, and clean up abandoned uploads. On a fresh published image request, PatchBoard checks visibility before issuing a five-minute link. Draft, pending, or otherwise restricted images are served only after checking the viewer on each fresh request. A previously issued public image URL may remain usable for its remaining lifetime. The browser-facing signed origin must work through the HTTPS proxy. Both media bytes and database records need off-VPS backups. [SeaweedFS single-node guide](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)

Deleting a board or organization takes it offline immediately. The owner can restore it during the 30-day window. After expiry a retryable purge removes the application's records and stored objects. Account deletion requires transferring or explicitly closing each owned organization. The implementation proposal is to retain a recovery-only verified-email path through the closure window, so a departing owner can exercise the recovery they were promised. Operator suspension survives an owner-initiated restore.

## Email

Use an operator-configured SMTP relay for verification, password recovery, staff invitations, board subscriptions, and staff alerts. Provide a local development inbox. A subscriber confirms their address for that board before receiving published Updates and can unsubscribe in one click. Staff opt into new-submission alerts separately. Updating a card, editing an existing announcement, or trying a change in Preview does not create a new announcement mailing.

Publishing an Update commits the content and a durable delivery event together. Deliver outside the web request, retry transient failures, and check current subscription and board state before delivery. A mail outage leaves already-published content available and routine password sign-in functional. Keep subscriber addresses and staff alert settings private.

## Performance contract

Measure production builds with **10,000 posts on one board and 1,000 comments on a popular post**. Record public mobile and creator desktop results independently. A cold visit uses the browser's Largest Contentful Paint metric. [LCP measurement](https://web.dev/articles/lcp)

| Scenario | Acceptance target |
| --- | --- |
| Cold visit to public board or shared post on a midrange phone | Readable content in initial HTML. Largest Contentful Paint (LCP) at or below **2.5 s at p75**. |
| Cold visit to the signed-in desktop workspace | LCP at or below **2.5 s at p75** with a cold asset cache and an established account session. |
| Open a populated post dialog or creator settings panel | Correct known content painted within **100 ms at p95** from input. Detail requests may still be outstanding. |
| Vote from a card or dialog | Visible vote feedback within **100 ms at p95**. Both surfaces agree after success or reconciliation. |

Open panels immediately. Render known fields from the selected row or query cache and show placeholders only for missing fields. Keep drafts local to their composer or panel so typing does not rerender the underlying board. Use optimistic updates for reversible votes, toggles, quick edits, and moves. Reconcile the affected entity after errors or ambiguous network outcomes. An old failed change cannot undo a newer successful change. Configuration toggles update the editor's draft immediately and persist on Save. Show publication as pending until confirmed.

Use transform/opacity for panel motion and respect reduced motion. Page lists at the server. Virtualize continuously scrolling lists, audit feeds, columns, and dropdowns that can otherwise mount over 100 items. A paginated page of 30 rows is already bounded. Preserve accessible navigation, focus, and scroll when an item leaves the rendered window. Refresh on focus and about every 30 seconds while visible. A background refetch preserves active drafts.

## Engineering baseline and verification

Use Rust with Axum, SQLx and PostgreSQL. Generate TypeScript request and response types from the Axum OpenAPI contract. Use React, TypeScript, shadcn/ui, TanStack Query, and TanStack Virtual. Separate public and creator entry bundles. Deliver the Dockerfiles, production Compose configuration, environment example, health checks, and a tested procedure to restore both database and media from an off-VPS backup. The operator supplies HTTPS, SMTP credentials, and the backup destination.

The [implementation plan](superpowers/plans/2026-11-26-patchboard-launch.md) identifies proposed engineering defaults, concrete test cases, and release checks. Work is accepted through the actual public, creator, operator, and Compose entry points, including failed writes, concurrent staff actions, and attempts to access another tenant's resources.
