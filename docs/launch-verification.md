# PatchBoard launch verification

The production application at `c43e9b74b733c93ef6e143705e1f91eb28c2e103` was tested on 26 November 2026. Both web entry points ran through the bundled gateway against Axum, PostgreSQL, private SeaweedFS, and a development SMTP inbox.

## Public mobile and creator desktop

The test board contained 10,000 posts, 20,000 votes, a post with 1,000 comments, and an uploaded image. A second organization contained a board with overlapping titles. The cold test used a fresh Chromium context on every visit and restored the staff session for the workspace. Cold LCP and time until populated controls appeared were recorded independently.

| Surface | Metric | Samples | Measured | Budget |
| --- | --- | ---: | ---: | ---: |
| Mobile public board | Cold LCP, p75 | 30 | 400 ms | 2,500 ms |
| Mobile shared post | Cold LCP, p75 | 30 | 1,820 ms | 2,500 ms |
| Desktop signed-in workspace | Cold LCP, p75 | 30 | 368 ms | 2,500 ms |
| Mobile post dialog with a held detail request | Input to painted title, p95 | 100 | 75.4 ms | 100 ms |
| Mobile vote | Input to painted vote state, p95 | 100 | 33.7 ms | 100 ms |
| Desktop creator settings | Input to painted panel, p95 | 100 | 19.3 ms | 100 ms |

Chromium 159.0.8154.6 ran on an AMD Ryzen 9 7950X3D. The mobile profile used 390 × 844, 4× CPU throttling, 150 ms RTT and 1.6 Mbit/s down. The desktop profile used 1440 × 900, native CPU, 40 ms RTT and 10 Mbit/s down. The measured image ID was `sha256:ff6c107a93c6fb3cb4f0d533a5c76dbb12b09ef67e1c90a0a163ab93cceb2dd0`. These figures describe emulated devices on the local production stack. Run `make perf` to regenerate raw samples and trace files in `artifacts/perf/`. [Measurement harness](../web/perf/measure.mjs)

## Functional and operational checks

| Check | Result |
| --- | --- |
| Rust format, Clippy with warnings denied, frontend typecheck, production build, and generated contract comparison | Passed. |
| `make test` | 2 image validation tests, 9 real PostgreSQL/API scenarios, and 4 frontend unit tests passed. |
| `make e2e` | 13 Playwright journeys passed. They exercised guest feedback and recovered ownership, Markdown and image editing, publication and locale, conflict handling, preview isolation, team transfer, operator suspension, and restoration. Chromium execution counts confirmed that typing in the comment composer or the creator's description field produced zero renders of the underlying card or canvas component. |
| `make compose-smoke` | Tested fresh startup, local SMTP delivery, quota contention, moderation access, signed image expiry, attachment editing, storage outage, and durable recovery after worker and service restarts. |
| `make restore-drill` | Restored the database and image bytes into a new Compose project. Verified checksums, public and pending media access, recovered guest identity, usage totals, and a retained mail job. |

The initial public HTML contains readable board or post content. The rich-text editor loads on demand. Its production chunk is about 168 kB gzipped and exceeds Vite's default 500 kB uncompressed chunk warning threshold. The application serves precompressed JS and CSS and gives content-hashed assets immutable cache headers.

The verification used a local reverse proxy and Mailpit. The VPS hostname, external TLS configuration, SMTP relay and protected off-host backup destination are installation inputs. [Deployment and recovery guide](../README.md)
