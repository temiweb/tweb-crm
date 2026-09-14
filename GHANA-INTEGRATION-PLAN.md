# Ghana / VDL Integration — Codebase-Accurate Plan

*Companion to the original build brief (`ghana-vdl-integration-brief.md`, external) and its revised form (`GHANA-VDL-INTEGRATION-BRIEF-REVISED.md`, in this repo). This document holds the **decisions, rationale, and scope boundaries**; the revised brief holds the **build detail**. Written 2026-09-11 against the CRM as it actually is (React+Vite+Supabase+Vercel, single-DB, egress-sensitive, edge functions pasted by hand, in-app toasts only).*

---

## 1. Why this document exists

The original brief is strong on safety and rollout, but it makes three assumptions about *this* codebase that don't hold, and one design choice that fights the egress work completed on 2026-08-21 ([[egress-incremental-sync]]). This plan records the decisions taken after review (brief + a third-party review + codebase check), so the build fits the system we actually have.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Package data from WPForms** | **Structured hidden values** — product code, quantity, expected total, discount as explicit fields. **Never parse the display label.** | Label-parsing ("Buy N") is exactly what mis-shipped Nigerian bundles ("Buy 2, Get 1 Free" → 2 not 3). Ghana has *no cancel endpoint*, so a wrong quantity is unrecoverable. We already run structured values on NG. |
| **Where Ghana/VDL columns live** | **Sidecar table `vdl_orders`** (1:1 with `orders` on `order_id`, Ghana rows only). **Do not widen `orders`.** | The client fetches `orders` with `select=*`. Widening adds ~25 mostly-null columns to every Nigerian order on every sync (~+1 MB/full load) — re-inflating the egress we just cut ~97%. Sidecar keeps the hot path lean; only the small Ghana view joins it. |
| **Alerting** | **Telegram bot** (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`), shared `alert()` helper. | The brief assumes an existing notification path. There is none — the codebase has only in-app toasts. Telegram is one secret + one `fetch`, free, mobile-push, no domain/approval. Alerting is load-bearing for an unattended, irreversible pipeline. |
| **Function deployment** | **`supabase functions deploy` from the repo**, adopted *before* building the four new functions. | Functions are currently pasted into the dashboard (review item #18). Four new money-and-shipment functions quadruple the repo-vs-deployed drift risk. Fix it while there is one function to migrate. |
| **Staff country scoping + status polling** | **Deferred to the final phase.** | Forward-looking only (no Ghana caller exists). Touches prod RLS with staging paused, and the finance-dashboard sibling app already broke once on an RLS change ([[finance-dashboard-sibling-app]]). No reason to carry that risk early. |
| **Catalogue sync cadence** | **Manual, then daily** — not hourly — until VDL rate limits are known. | Protects against unknown VDL rate limits / function-invocation cost (not client egress). Easy to tighten later. |

## 3. Scope boundary — "a small VDL workspace, not a Ghana CRM rebuild"

This is a discipline held throughout, not a one-time toggle. Ghana is a **fulfilment integration**: capture the order, let a human fix the address, push to VDL, mirror status/financials back. VDL owns delivery, customer contact, and the order lifecycle after push.

**Ghana reuses:** the `orders` table's existing columns (name, phone, address, `state`=region, product, qty); the webhook→edge-function→DB intake shape; Phase-0 alerting and deploy tooling.

**Ghana deliberately does NOT get (enforce in code, not just convention):**
- **No caller queue / assignment / caller stats.** VDL contacts customers. Auto-assign and caller-rotation logic must **skip `country='ghana'`**; Ghana orders never get `assigned_to` and never appear in "My queue."
- **No agent/inventory machinery.** Ghana "stock" is VDL's catalogue mirror (`quantity_available`), read-only. Never wire it into waybills, transfers, faulty-stock, or the agent-stock model — those are Nigerian delivery logistics.
- **No Ghana analytics rebuild.** The Analytics screen is Nigeria-shaped (the decision-metrics RPC is Nigeria-only; plus agent leaderboard, caller effectiveness, stock-by-state — none apply). Ghana gets a *thin* readout (orders in / pushed / delivered-by-VDL-state / VDL financials) in the Ready-to-Push "Synced" tab and the finance dashboard. **Do not** make the analytics suite "work for Ghana too" — the biggest rebuild trap.
- **No NG status workflow on Ghana orders.** Keep `vdl_state_label` separate from the 16-status NG taxonomy and the money-guard/collected-cash logic. Map VDL states onto familiar chips **for display only** — never to trigger NG behaviour (timestamp stamping, inventory decrements, auto-assign).

**The practical test:** the NG country switcher was deprecated (`country` is now hardcoded to `"nigeria"`), so Ghana lives in its **own top-level "Ghana (VDL)" nav section** — the read-only catalogue (Phase 1) and the Ready-to-Push view (Phase 2) — not a Ghana mode of the caller/agent/inventory/analytics screens. If you find yourself making an existing NG screen "Ghana-aware," that's the rebuild creeping in; the answer is almost always "Ghana doesn't need that screen."

## 4. Kept from the brief without change

Endorsed wholesale — these are the brief's strengths:
- Human approval before any VDL submission; never auto-save (§9). The spine of the design.
- Hold, never guess: any validation failure → `held`, no lenient fallback (no cancel endpoint).
- Idempotency on `wpforms_entry_id`; timeout-dedup via search-by-phone before any retry (§6.4) — the sharpest safety detail in the doc.
- Staged rollout with exit criteria; the userscript retained as fallback throughout.
- No automatic re-authentication (§2.1); `discount_amount` semantics as a hard blocker (§3.2).

Added from the third-party review:
- Global **circuit-breaker on sustained 5xx** (beyond per-order backoff) so a VDL outage pauses the loop instead of each order backing off alone.
- Finance: keep **VDL-quoted settlement figures** (`amount_due_customer`, `vendor_amount_due`, …) **separate from actually-remitted cash** — VDL's promise ≠ money landed.

## 5. Revised phased build order

Each phase runs several days before the next; the userscript stays installed throughout.

- **Phase 0 — Foundations the brief assumed existed.**
  (0a) Adopt `supabase functions deploy`; migrate `wpforms-intake`, confirm deployed==repo. (0b) Telegram `alert()` helper + secrets, tested end-to-end. (0c) Resolve VDL unknowns with live calls: discount per-unit/line (§3.2), status list (§3.3), cancel/return charges (§3.6), timeout lookup (§6.4), fee arithmetic (§3.4). Record in README. *No push code until these are settled.*
- **Phase 1 — Schema + catalogue (read-only).**
  Migration `0016`: `gh_regions` (seed 17), `gh_products` (mirror), sidecar `vdl_orders`. `vdl-product-sync` run manually→daily; surface `quantity_available` as a distinct read-only panel; low-stock alert. *Exit: products + stock visible.*
- **Phase 2 — Intake + Ready-to-Push view (NO pushing).**
  Ghana forms get structured hidden fields (code, qty, expected total, discount); keep Product Name for userscript fallback. `order-intake-gh` reads structured fields directly, idempotent, inserts `orders`(country=ghana) + `vdl_orders`(needs_review). Ready-to-Push view: Needs review / Held / Synced, editable location, Approve (+bulk), in-app Held badge. *Exit: every Ghana order in the CRM with correct fields, 3 straight days. Standalone value even if the rest is abandoned.*
- **Phase 3 — Push worker (manual approval, one at a time).**
  `vdl-push-worker`: atomic claim (`for update skip locked`, mark `pushing` in a short txn, commit, *then* call VDL — never hold the txn across the HTTP call), four preflight guards, body from structured fields, serialized. Post-call: financials → sidecar; price guard → alert; 401 → auth_failed+halt+alert; other 4xx → failed; 5xx/timeout → backoff + global circuit breaker; timeout → search-by-phone dedup first. Watchdog: alert on any order `approved` > 30 min. *Exit: 10 orders pushed, every amount matches expected, zero duplicates.*
- **Phase 4 — Full volume.** Userscript retired (not uninstalled). *Exit: 1 week clean.*
- **Phase 5 — Status poller + staff scoping (last).**
  `vdl-status-poller` every 20 min, per-tracking-id, map states for display, refresh financials, unknown→review. Then `staff.countries` + RLS extension — carefully, on prod, **tested against the finance dashboard before and after.**

**Parallel track (separate repo/session):** update the finance dashboard to consume VDL settlement figures, keeping VDL-quoted vs actually-remitted separate.

## 6. Open blockers (must be answered before Phase 3)

From the brief's §3, unchanged and still required: discount per-unit vs per-line (§3.2 — mischarges every multi-unit order if wrong); full order-state list (§3.3); fee arithmetic under `products_include_delivery` (§3.4); failed/returned orders still charged? (§3.6); one controlled live order before enabling auto-push.

---

*Bottom line: the brief's safety model and rollout are sound; this plan swaps two design choices (structured values, sidecar) to protect correctness and the egress win, names the two prerequisites it assumed existed (alerting, clean deploys), defers the risky RLS work, and draws a hard line around scope so Ghana stays a workspace, not a second CRM.*
