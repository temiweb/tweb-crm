# Infinistores CRM v2 — Implementation Plan

> Repo-grounded plan for the build brief, adapted to the **actual** codebase:
> single-file `src/App.jsx` (~1,086 lines), custom `sb` fetch client, inline-style theme `T`,
> shared-PIN auth, hardcoded Supabase keys, **live DB only**.
>
> **Decisions locked:** Plan first (no code yet) · stay single-file & add incrementally · only the production DB exists.

---

## 0. Guardrails (because we're pointed at the live DB)

These hold for every phase below:

1. **Additive & reversible only.** New tables, new *nullable* columns, new policies. No `DROP`, no renames, no `NOT NULL` on existing data.
2. **No schema change touches prod until it's run on staging first.** See §1.
3. **RLS is a one-way cutover risk.** The app today talks to Supabase with the anon key and *no logged-in user*. The instant RLS is enabled on a table, every current query against it returns empty/blocked unless a matching policy + real auth session exists. So anything RLS-related (Phase 6) ships as one coordinated, staged cutover — never piecemeal on prod.

---

## 1. Prerequisite: staging + secrets (do before ANY schema work)

Currently `SUPABASE_URL` / `SUPABASE_KEY` are hardcoded at the top of `App.jsx` and committed. Two low-risk foundation steps unlock safe iteration:

- **1a. Move keys to Vite env vars** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`). Zero behavior change in prod (same values via Vercel env), but it (a) stops committing credentials and (b) lets a preview deploy point at staging by swapping env vars only.
- **1b. Stand up a free second Supabase project = "staging."** Recreate the current schema there, seed dummy NG+GH data. Point the Vercel **preview** env (and your local `.env`) at staging. Production env stays on the live project, untouched.
- **1c. Start a `supabase/migrations/` folder.** Every schema change from Phase 3 onward is a versioned `.sql` file, applied to staging first, rollback tested once, then prod.

> Note: an anon key in client code is normal for Supabase — *if* RLS is on. Yours isn't, so today the key effectively grants full read/write to anyone who views source. Phase 6 closes this; until then, don't widen exposure.

---

## 2. Phase plan

Ordered so nothing blocks and risk rises gradually. Phases 2 & 5 carry **zero DB risk** and can ship to prod anytime. Phases 3, 4, 6 are **gated on staging**.

### Phase 2 — Design system v2 (visual only, no DB risk) ✅ safe now
- Inject the v2 `css` block from `infinistores-crm-v2.jsx` as a single `<style>` element in `App.jsx`. This fits the single-file approach cleanly (CSS classes + CSS variables instead of growing the inline-style `T` object).
- Port the shell: deep-green command rail, topbar (search / NG-GH segment / notifications / avatar), and the primitives — `KPI`, `StatusPill`, `StatusDropdown`, `DataTable` conventions, `RowActions`.
- Reskin existing screens onto the primitives. **Map the current 8 statuses into the pill system visually first** — defer the 13-status DB change to Phase 3.
- Keep the existing `Pagination`, toast, offline-badge, and 30s auto-refresh logic — they're orthogonal to styling.
- **Open decisions:** (a) icons — adopt `lucide-react` (new dependency, matches v2) or keep current emoji set; (b) brand — rename "Tweb Shop" → "Infinistores" or keep.

### Phase 3 — Orders: grouped reason-code statuses + history 🔒 staging-gated
- **First real schema change.** Add status model additively. Recommended: an `order_statuses` lookup table (`code`, `label`, `group`) so the same field drives both confirmation UI and the dashboard funnel.
- **Backfill mapping** (current → brief). ⚠️ The brief's 13 statuses are **missing 3 of your live operational statuses** — adopting them verbatim loses information. Proposed mapping:

  | Current status | → Proposed v2 | Group | Note |
  |---|---|---|---|
  | `pending` | Pending | progress | clean |
  | `confirmed` | **Confirmed** *(add)* | progress | brief has no "Confirmed"; keep it — it's a distinct real state |
  | `not_reachable` | Not Answering | noreach | going forward callers pick the specific sub-reason (Busy/Switched Off/etc.) |
  | `postponed` | Rescheduled | progress | clean |
  | `cancelled` | Cancelled | failed | clean |
  | `delivered` | Delivered | done | clean |
  | `failed_delivery` | **Failed Delivery** *(add)* | new `failed_delivery` group | brief's funnel counts this but its status list omits it |
  | `out_of_stock` | **Out of Stock** *(keep)* | noreach/own | brief has no equivalent |

  → Recommendation: take the brief's 13 **plus** keep `Confirmed`, `Failed Delivery`, `Out of Stock`. Confirm before building.
- **`order_status_events`** history table (additive, `on delete cascade`). Write a row app-side on every status change in `doUpdateStatus` / `doSaveOrder` / bulk ops. (DB trigger optional later.)

### Phase 4 — Inventory sub-sections 🔒 staging-gated
- Sub-nav tabs: Products / Agent stock / Waybills / Buy stock / Faulty stock.
- **Your existing `inventory` table (`agent_id, product_name, qty`) already IS the brief's `agent_stock`** — reuse it, don't duplicate. "Agent stock" tab = current data.
- Add **`waybills`** table (additive). Mark waybill delivered → increment agent stock. The Products "With agents" column = sum of `inventory.qty` per product.
- ⚠️ Decision: your schema keys stock by `product_name` (string); the brief uses `product_id` FK. Keeping strings is lower-risk and matches today's code — recommend staying with `product_name` unless you want the FK cleanup.

### Phase 5 — Agent performance (no DB risk) ✅ safe now
- Per agent: assigned / delivered / in-transit / cancelled, delivery rate %, units in hand, revenue delivered.
- **Compute client-side** from already-loaded orders + inventory (we already fetch all orders via `queryAll`). No DB view needed — zero risk, fits single-file. A SQL view can come later if perf ever demands.
- Treat **VDL Ghana as an agent row** so NG + GH share one model.

### Phase 6 — Staff + Auth + RLS (the hard one) 🔒 staging-gated, coordinated cutover
This is a foundation change, not a module. Sequence on staging end-to-end before prod:
- **6a.** Enable Supabase Auth. Add `staff` table linked to `auth.users` (`role` in admin/caller/viewer, `pay_per_delivered`).
- **6b.** Replace the shared **PIN** login with real per-user email/password login. Biggest UX change in the whole brief. (Optionally keep PIN as a temporary fallback during rollout.)
- **6c.** `invite-staff` **Edge Function** (service role, server-only). ⚠️ **This is the one part that cannot live in `App.jsx`** — it needs `supabase/functions/`. The single-file rule gets this one documented exception. Service-role key lives only in Edge Function secrets, never in the repo.
- **6d.** Add `assigned_staff_id` to `orders` (additive, nullable).
- **6e.** RLS policies (admin / caller / viewer) per the brief. Enable RLS on every staff-touchable table **only after** auth + policies + a logged-in test user are verified on staging — this is the breakage point from §0.3.
- **6f.** Staff performance + earnings: **earnings = delivered × `pay_per_delivered`** (never tied to confirmations). Compute client-side or via the `staff_performance` view.
- **Feature-flag the whole module** (`VITE_FEATURE_STAFF`) so it stays dark in prod until the cutover is verified.

---

## 3. What's safe to ship now vs. what waits

| Safe to prod anytime (no DB schema risk) | Gated on staging first |
|---|---|
| 1a env vars, 1c migrations scaffold | Phase 3 status model + history |
| Phase 2 design system + orders reskin | Phase 4 waybills |
| Phase 5 agent performance (client-side) | Phase 6 staff / auth / RLS |

---

## 4. Decisions still needed before coding each phase

1. **Icons:** `lucide-react` (new dep) vs keep emoji.
2. **Brand:** rename to "Infinistores" vs keep "Tweb Shop".
3. **Status set:** confirm the proposed 13 + 3 kept statuses and the backfill mapping (§Phase 3).
4. **Inventory keys:** keep `product_name` strings vs introduce `product_id` FKs.
5. **Auth cutover:** full move to per-user login, or keep PIN as fallback during rollout.
6. **Staging:** confirm you'll create the second free Supabase project (required before Phase 3+).

---

## 5. Recommended starting point

Phases **1a/1b (env + staging)** then **Phase 2 (design system)**. Reason: env+staging is the cheap, reversible foundation that makes everything after it safe; the design system is high visual payoff with zero database risk, so it's the safest place to see real progress while staging is being set up in parallel.
