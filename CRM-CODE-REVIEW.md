# Infinistores CRM — Full Code & System Review

*Audit date: 2026-07-01 · Scope: src/App.jsx (2,316 lines), both edge functions, migrations 0001–0007, index.html, deployment & ops.*
*Prioritised: P0 = real bugs / integrity risks · P1 = security hardening · P2 = architecture & scale · P3 = UX/polish.*

---

## What's genuinely solid (keep doing this)

- **RLS coverage is real security**, not decoration — every table has policies; caller scoping (`assigned_to = auth.uid()`) was verified from the caller's side; the legacy "Allow all" policies were found and removed.
- **Migrations are additive, idempotent, and staged** — every schema change ran on staging first, with backfills that are safe to re-run.
- **The webhook is defensively written** — idempotent upserts, date-scoped dedup, graceful fallback when columns are missing (an order is never lost), auto-assign with a no-caller fallback.
- **Feature-flag discipline** (`VITE_FEATURE_CALLER`) kept unfinished work dark in prod.
- **Optimistic UI + reload-on-error** is a consistent pattern across all ~15 mutations.
- **Status history** is timestamped and append-only — a real audit trail.
- Secrets audit: the webhook token and service-role key are **not** in any tracked file; `.env` is gitignored. ✔

---

## P0 — Real bugs (fix first)

### 1. The mid-session "Connection Error" screen can still happen — stale closure in the poll
`App.jsx:874` registers the 30s poll when `authed` flips true. At that moment `loadAll`'s closure has `loaded === false` (data hasn't finished loading), and the interval **never re-captures it**. So any transient network failure during a poll takes the `if (!loaded)` branch (`App.jsx:814`), retries 3×, then calls `setLoadError` → the **full-screen blocking error you specifically asked to get rid of**. The retry logic reduced how often you see it; this closure is *why* you ever see it mid-session.
**Fix:** track `loaded` in a `useRef`, or re-register the interval on `[authed, loaded]`.

### 2. Silent "all my orders disappeared" state when a session dies
`loadAll` calls `auth.ensureFresh()` (`App.jsx:787`) but **ignores its return value**. If the refresh token has expired/been revoked, `ensureFresh` signs the user out internally — then the queries proceed with the anon key, RLS returns **empty arrays**, and the app happily renders "Import a CSV to get started" with zero orders while still *looking* logged in. A staff member would think the data vanished.
**Fix:** if `ensureFresh()` returns false → `doSignOut()` and show the login screen.

### 3. Callers can edit money fields on their own orders
RLS is row-level: a caller may UPDATE any column of an assigned order — including `price`, `actual_price_collected`, `delivery_fee`, and setting `status = delivered`. Since **Delivered = cash collected** in your books, a caller could understate collected cash or inflate their delivery rate. Today, with staff you trust and the status-history log as a deterrent, it's a controlled risk — but it's the #1 integrity gap before you scale the team.
**Fix (pick one):**
- a DB trigger that rejects changes to money columns unless `current_staff_role() in ('admin','manager')` — strongest;
- or a weekly reconciliation SOP: delivered orders vs agent cash reports (you already planned this informally).

### 4. Inline components remount on every render
`PeriodFilter` (`App.jsx:1418`), `StatsStrip` (1446), and `CountrySeg` (1884) are **defined inside** the main component. Each state change creates a new component identity → React unmounts/remounts them. Concrete symptom: the **custom date-range inputs lose focus while typing** (each keystroke rebuilds the input). Also wasted rendering.
**Fix:** hoist them to top level and pass props (mechanical, ~20 min).

### 5. Housekeeping from the build process
- `ACCESS_PIN = "4285"` (`App.jsx:21`) is **dead code** — the PIN screen is gone. Remove it; it reads like a live credential.
- The **staging caller password was shared in plain chat** during testing — rotate it (staging only, but good hygiene).
- The `ZZ AUTOASSIGN TEST` order may still sit on staging; harmless, but clean when convenient.

---

## P1 — Security hardening

6. **Column-level read exposure.** Callers/viewers can read money columns via direct API calls (the UI only *hides* them). Fix properly with a restricted **view** (e.g. `orders_caller` without money columns) or accept as low-risk for a small trusted team — but decide consciously.
7. **Webhook token travels in the URL query string** (`?token=…`). Query strings get recorded in server/proxy logs. Move it to a header (WPForms supports request headers — the original plan's `x-webhook-secret`). Low urgency, easy win at the next webhook touch.
8. **`invite-staff` CORS is `*`** — scope `Access-Control-Allow-Origin` to `https://tweb-crm.vercel.app`.
9. **No "Forgot password" UI.** The recovery *handler* exists (invite/recovery hash is processed), but there's no button to request a reset — a locked-out caller needs you to intervene in the Supabase dashboard. Small add: "Forgot password?" link → `POST /auth/v1/recover`.
10. **Tokens in `localStorage`** — standard for SPAs but XSS-sensitive. Current exposure is minimal (no third-party scripts beyond Google Fonts). Adding a **Content-Security-Policy** header via `vercel.json` would materially raise the bar.
11. **No rate limiting on the webhook** — someone with the token could flood orders. Acceptable now; note for later (Supabase edge functions + a simple counter, or move behind Vercel middleware).

---

## P2 — Architecture & scale

12. **The polling model is the biggest scaling constraint.** Every signed-in client re-downloads **every order, every column, every 30 seconds** (`queryAll` pages of 1,000). At ~1,400 orders that's already 2 requests/poll/client; it grows linearly forever — 10k orders ≈ 10 requests and multi-MB payloads per poll per device. Options in order of effort:
    - *Cheap:* `select=` only the columns the list needs; archive old orders out of the default fetch (e.g. fetch last 90 days + on-demand history).
    - *Better:* incremental sync — fetch only rows where `updated_at > lastSyncTime`.
    - *Best:* Supabase **Realtime** subscriptions (push, not poll) — also removes the 30s staleness window.
13. **Poll vs optimistic-update race.** If a poll response is in flight when a user edits an order, the poll's stale snapshot overwrites the optimistic state until the next poll. Rare at current scale; incremental sync (above) largely eliminates it.
14. **Inventory math is client-side read-modify-write.** The "fresh fetch before write" narrowed the race window but it isn't atomic — two devices delivering the same agent's product simultaneously can still lose a decrement. Proper fix: a Postgres **RPC function** (`decrement_agent_stock(agent, product, qty)`) or a trigger on delivered — single atomic statement, and it moves the business rule into the DB where RLS lives.
15. **Bulk operations fire N parallel requests** (`App.jsx:1146,1164,1173`) — one PATCH per order. A single `id=in.(…)` PATCH does it in one round trip (matters at 100+ selected).
16. **The 2,316-line single file** was a deliberate choice and still works, but it's at the threshold where finding things costs time. A light split (`sb`/auth/helpers → `lib.js`, screens stay together) preserves the spirit while halving navigation pain. Optional — your call, not urgent.
17. **Zero automated tests.** The highest-value, lowest-effort suite: unit tests for `parsePackage`, `cleanPhone`, `csvToDbRows`, `orderClipboard`, `stampFor`, `deliveryDateOf` — pure functions, and exactly the class of code that's silently broken before (the CSV "Buy N" qty bug). ~1 hour with Vitest, permanent regression protection for the money-parsing path.
18. **Edge-function drift risk.** Functions are deployed by pasting into the dashboard; the repo copy and the deployed copy can silently diverge (this nearly bit us during the RLS cutover). Adopt `supabase functions deploy` from the repo, or at minimum treat the repo as canonical and always paste from it.
19. **No error monitoring or webhook alerting.** If the webhook starts failing (expired token, schema change), orders stop arriving **silently** — you'd notice via missing sales, not an alert. Mitigations: keep WPForms email notifications on as a parallel record (they are); add a simple daily check ("orders today = 0 → investigate"); longer-term, Sentry (free tier) for the front-end and a log-based alert on function failures.
20. **Backups.** You're on Supabase's automatic daily backups. For an order book that *is* the business, add a weekly manual export (CSV of orders) or a scheduled dump to storage. Cheap insurance.

---

## P3 — UX, visual & accessibility polish

21. **`caps.orders` is defined but never used** — viewer/accountant roles see *editable* status dropdowns and Edit buttons that fail at the database with an error toast. Gate them to read-only when `caps.orders === "view"`.
22. **`window.confirm` ×4** for deletes — native dialogs clash with the design system and block the JS thread. Replace with a styled confirm modal (you already have the Modal primitive).
23. **Pinch-zoom is disabled** (`index.html:6` — `maximum-scale=1.0, user-scalable=no`). Real accessibility problem for low-vision users on mobile (WCAG 1.4.4). Remove those two attributes; the layout doesn't need them.
24. **Icon-only buttons lack `aria-label`s** (call, WhatsApp, edit, delete, refresh, lock). Titles exist on some; screen-reader users get nothing on others.
25. **Error toasts auto-dismiss in 5s** — a caller mid-call can miss a failed save. Consider errors persisting until dismissed (successes can keep auto-dismiss).
26. **Order age isn't visible in the caller queue** — the queue sorts oldest-first, but nothing *shows* age. A subtle "3h / 2d" chip would help callers triage and help you spot rot.
27. **The NG/GH switcher** takes prime header space for a country you don't operate in the CRM. Hide GH behind a flag until needed; declutters every screen.
28. **PWA install** — a tiny `manifest.json` + the existing theme-color meta lets callers "Add to Home Screen" as an app-like icon. Nice for field staff; ~30 min.
29. **Login niceties** — no "show password" toggle; error messages are good.
30. **Same-day duplicate suppression trade-off** (webhook dedup key = phone+package+name+day): a customer genuinely ordering the *same product twice in one day* is silently merged. Rare and deliberate — but keep it in mind when a customer says "I ordered two."

---

## Suggested attack order

| Round | Items | Effort |
|---|---|---|
| **Now (bug-fix pass)** | P0 #1, #2, #4, #5 (dead PIN, rotate staging pw) | ~1–2 hrs, frontend-only → main |
| **Integrity pass** | P0 #3 (money-column trigger) + P1 #9 (forgot password) + P3 #21 (viewer gating) | Small; trigger goes via staging |
| **Hardening pass** | P1 #6–8, #10 (CSP) | Small-medium |
| **Scale pass (when order volume or team grows)** | P2 #12 (incremental sync/Realtime), #14 (atomic inventory RPC), #17 (tests) | The real project |
| **Polish, opportunistically** | P3 #22–28 | As desired |

*Bottom line: the system is sound — secure at the row level, disciplined in how it changed, and honest in its data. The P0 list is short and fixable in an afternoon; the architecture will comfortably carry you until order volume or team size grows, and the upgrade path (Realtime, atomic inventory, tests) is clear when it does.*
