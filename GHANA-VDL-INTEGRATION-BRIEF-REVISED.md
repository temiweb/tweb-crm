# Ghana Order Automation — Build Brief (Revised)

**System:** Infinistores CRM (React + Vite + Supabase + Vercel)
**Goal:** Ghana orders flow from WPForms into the CRM automatically, and from the CRM into VDL Fulfilment via their vendor API, replacing manual re-entry through the Tampermonkey userscript.
**Status:** Revised 2026-09-11 to fit the CRM as built. Rationale and scope boundaries live in `GHANA-INTEGRATION-PLAN.md`; this document is the build spec.

## Changelog vs the original brief

1. **Structured WPForms values, not label parsing** (§4.1b, §5.3). Product code, quantity, expected total, and discount arrive as explicit hidden fields. The display label is never parsed for numbers. *Reason: label-parsing mis-shipped NG bundles; Ghana has no cancel endpoint.*
2. **Sidecar `vdl_orders` table, not widening `orders`** (§4.2). All Ghana/VDL columns live in a 1:1 sidecar. *Reason: the client fetches `orders` with `select=*`; widening re-inflates the recently-cut egress.*
3. **Alerting is net-new (Telegram bot), not "reuse existing path"** (§6.5). There is no server-side notifier in the codebase — only in-app toasts.
4. **Phase 0 added** (§0): adopt `supabase functions deploy` and build alerting *before* the four functions.
5. **Staff country scoping + status poller deferred to the final phase** (§4.3, §8, §11).
6. **Catalogue sync starts manual→daily, not hourly** (§7).
7. **Global 5xx circuit-breaker added** to the push worker (§6.4).
8. **Finance: VDL-quoted figures kept separate from actually-remitted cash** (§2.3).
9. **Explicit scope boundary** — Ghana is a small VDL workspace, not a CRM rebuild (§0.1, and `GHANA-INTEGRATION-PLAN.md` §3).

---

## 0. Foundations (Phase 0 — build first)

These are prerequisites the original brief assumed already existed.

**0a. Repo-based function deploy.** Switch from dashboard paste to `supabase functions deploy`. Migrate the existing `wpforms-intake` function, confirm the deployed copy matches the repo. Do this while there is one function to migrate — four new money/shipment functions multiply the drift risk (review item #18).

**0b. Alerting (`_shared/alert.ts`).** A shared helper `alert(level, message)` that POSTs to the Telegram Bot API (`https://api.telegram.org/bot<token>/sendMessage`, `{chat_id, text}`). Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Rules:
- Alert **at the moment of state change** (inside the code that sets `held`/`failed`/`price_mismatch`/`auth_failed`), never on every poll.
- Include order id + `tracking_id` + the specific `vdl_sync_error`.
- Add a **watchdog**: alert if any order sits in `approved` > 30 min (catches a dead cron — the one failure a per-order alert can't).

**0c. Resolve the VDL unknowns** (§3) with live calls; record answers in the README. No push code until §3.2 is settled.

### 0.1 Scope boundary (enforce in code)

Ghana is a fulfilment integration, not a second CRM. When `country='ghana'`: no caller queue/assignment/stats (auto-assign & caller-rotation logic must skip Ghana orders); no agent/inventory machinery (VDL catalogue stock is read-only, never wired into waybills/transfers/faulty); no Ghana analytics rebuild; VDL states map to familiar chips **for display only**, never to trigger NG status behaviour. See `GHANA-INTEGRATION-PLAN.md` §3.

---

## 1. Context

### 1.1 Current state

Nigerian orders reach the CRM via the WPForms Webhooks addon, per-form. **That path is not modified by this project.** Ghana orders currently reach the CRM not at all — they exist only as WPForms notification emails and inside VDL's dashboard, entered manually via the `vdl-order-autofill.user.js` (v1.1) userscript (parses the email, autofills VDL's "Add New Order" modal; the operator reviews and clicks Save — never auto-saves).

Business rules the userscript encodes and this project preserves: `+233` phone normalisation; a `comment` = alt phone + notes + full raw address; a cleaned location field; quantity/discount from the package; product identity from a hidden Product Code; and never-save-silently warnings on price/stock/region.

### 1.2 What changes

WPForms (Ghana) → webhook → `order-intake-gh` → `orders` + `vdl_orders` row → **human approves address** → `vdl-push-worker` → `POST /orders/create` → `tracking_id` written back → `vdl-status-poller` reads status back (Phase 5). The userscript stays installed as a fallback throughout rollout.

### 1.3 Non-goals

No changes to the Nigerian intake path. No Ghana landing-page changes beyond added form fields. No caller queue for Ghana. No cancel/amend via API (VDL exposes none).

---

## 2. The VDL Vendor API

Laravel backend, Bearer token auth. Endpoints used here:

| Endpoint | Method | Use |
|---|---|---|
| `/orders/create` | POST | Create an order |
| `/orders/{tracking_id}` | GET | Read one order's state + financials |
| `/orders?search=<phone>` | GET | Timeout dedup lookup |
| `/products` | GET | Catalogue with `quantity_available`; paginated |
| `/regions` | GET | 17 Ghana regions with IDs; seed once |

**Base URL:** `https://api.vdlfulfilment.net` (`VDL_API_BASE_URL`). The dashboard host `app.vdlfulfilment.net` is session-cookie auth and must never be called from this integration.

### 2.1 Auth

JWT valid until **3 March 2027**, stored as `VDL_API_TOKEN`; sent `Authorization: Bearer <token>`, `Accept: application/json`. **No automatic re-auth** (would require storing the dashboard password). On `401`: mark `auth_failed`, halt the push loop, alert. Manual annual refresh — calendar reminder for Feb 2027. The live token in the exported Postman collection must never be committed.

### 2.2 Create Order — request

```
POST {base}/orders/create   (Bearer, Accept + Content-Type: application/json)
{
  "customer_name": "", "customer_location": "",   // closest landmark, not postal
  "customer_phone_number": "",                     // +233
  "amount_received_from_customer": 0,              // always 0 — full COD
  "comment": "", "region_id": 0,
  "products": [ { "code": "", "quantity": 0, "discount_amount": 0 } ]
}
```
**No price field.** VDL computes the customer total from the unit price registered against `code` in its own catalogue — so the landing-page price and VDL's catalogue price must agree (the §6.4 price guard catches drift).

### 2.3 Create Order — response (persist all five financial fields)

`data.tracking_id`, `id`, `commission_amount`, `amount_due_customer`, `vendor_amount_due`, `delivery_fee`, `packaging_fee`, `order_status`, `model_state.{id,label}`, per-product `pivot`.

These are the source of truth for Ghana unit economics **as quoted by VDL** — store them **separately from actually-remitted cash** in the finance dashboard (VDL's promise ≠ money landed; failed deliveries and settlement timing diverge). Documented arithmetic `vendor_amount_due = amount_due_customer − commission_amount − delivery_fee`; `packaging_fee` unclear — verify against a real settlement (§3.4).

### 2.4 Known API limitations

No webhooks (poll only). No `updated_since`/status filter on `/orders` (poll per-`tracking_id`). No status history (only `created_at`, `fulfilled_at`). No failure reason codes. No cancel/update. State machine undocumented (only Pending id 10, Confirmed id 2, Packaged seen — discover empirically). Rate limits unknown — serialise pushes with a delay.

---

## 3. Unknowns to resolve before push code (blockers)

- **3.1 Base URL — RESOLVED:** `https://api.vdlfulfilment.net`.
- **3.2 `discount_amount` per-unit vs per-line — BLOCKER.** Test `code:"5Mnrt"`, `quantity:2`, `discount_amount:60`. `amount_due_customer 300.00` → per-line (send parsed figure unchanged). `240.00` → per-unit (divide by quantity; set `VDL_DISCOUNT_PER_UNIT=true`). *No auto-push until settled — a wrong answer silently mischarges every multi-unit order.*
- **3.3 Full state list.** Log every `model_state.{id,label}`; until known, unrecognised → `unknown` (surfaces in review, never defaults).
- **3.4 Fee arithmetic under `products_include_delivery`** (vendor account has it ON). Verify `amount_due_customer` == advertised price; confirm whether `packaging_fee` is deducted from `vendor_amount_due` or billed separately.
- **3.6 Are failed/returned orders still charged `delivery_fee`?** Determines Ghana CPA ceiling.

---

## 4. Schema (additive, reversible — migration `0016`)

### 4.1 Reference tables

`gh_regions` (17 rows, seeded once from `/regions`; effectively static) — `vdl_region_id` PK, `name` unique, `code`. Seed values per the original brief §4.1.

`gh_products` (catalogue mirror; refreshed manual→daily) — `code` PK, `vdl_product_id`, `name`, `active`, `quantity_available`, `synced_at`. Nothing hand-maintained. Known codes: Night Driving Glasses `TMDGLAS`, 5m Net Repair Tape `5Mnrt`, Heavy Duty Mesh Tape `HDMT`, Car Scratch Remover Kit `CSRT`.

### 4.2 Sidecar `vdl_orders` (NOT columns on `orders`)

```sql
create table public.vdl_orders (
  order_id            uuid primary key references public.orders(id) on delete cascade,
  wpforms_entry_id    text,
  -- structured intake values (from hidden form fields, never parsed from a label)
  gh_product_code     text,
  gh_quantity         integer,
  gh_expected_total   numeric(10,2),
  gh_discount_amount  numeric(10,2),
  gh_region_name      text,           -- must match gh_regions.name exactly
  gh_package_label    text,           -- stored for display/audit only
  gh_raw_address      text,           -- verbatim from the form
  gh_location         text,           -- operator-corrected landmark; sent as customer_location
  -- sync state machine
  vdl_sync_status     text not null default 'needs_review',
  vdl_sync_error      text,
  vdl_sync_attempts   integer not null default 0,
  vdl_next_attempt_at timestamptz,
  vdl_synced_at       timestamptz,
  -- VDL identity + financials (as quoted by VDL)
  vdl_order_id            integer,
  vdl_tracking_id         text,
  vdl_state_label         text,
  vdl_amount_due_customer numeric(10,2),
  vdl_vendor_amount_due   numeric(10,2),
  vdl_commission_amount   numeric(10,2),
  vdl_delivery_fee        numeric(10,2),
  vdl_packaging_fee       numeric(10,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists vdl_orders_wpforms_entry_id_key
  on public.vdl_orders (wpforms_entry_id) where wpforms_entry_id is not null;
create index if not exists vdl_orders_push_queue_idx
  on public.vdl_orders (vdl_sync_status, vdl_next_attempt_at);
create index if not exists vdl_orders_tracking_idx
  on public.vdl_orders (vdl_tracking_id) where vdl_tracking_id is not null;
```

Reuse the existing `orders` columns for name/phone/address/`state`(=region)/product/qty/`country='ghana'`. Nigerian orders get **no** `vdl_orders` row and are never touched by this system. Apply the `set_updated_at` trigger pattern (migration 0011) to `vdl_orders`.

`vdl_sync_status`: `needs_review` (awaiting address approval) · `held` (a guard tripped — see `vdl_sync_error`) · `approved` (eligible for push) · `pushing` (claimed) · `synced` (`vdl_tracking_id` populated) · `failed` (retries exhausted) · `auth_failed` (401 — loop halted globally).

### 4.3 Staff country scoping — DEFERRED to Phase 5

`alter table public.staff add column countries text[] default '{NG}'`; extend order-visibility RLS to a country membership check. Forward-looking; no caller works Ghana today. Land it last, on prod (staging paused), **tested against the finance dashboard before and after** (prior ₦0 incident).

---

## 5. Edge Function `order-intake-gh` (HTTP)

### 5.1 Auth
WPForms custom header `x-intake-secret` compared constant-time to `GH_INTAKE_SECRET`. Mismatch → log-and-discard `401`.

### 5.2 Payload (map via smart tags; names are the contract)
`entry_id` (req), `customer_name` (req), `phone` (req), `alt_phone`, `address` (req, multiline), `region` (req), `product_code` (req — hidden), **`quantity` (req — hidden), `expected_total` (req — hidden), `discount` (hidden, default 0)**, `package_label` (display/audit), `notes`, `page_url`/`utm_*`.

### 5.3 Processing
1. Verify secret.
2. Normalise phone → `+233` (`+233`/`233`/`0`/bare-9-digit); anything else → insert but `held`, reason `bad_phone`.
3. Collapse multiline address to one line (`, ` separated); store verbatim in `gh_raw_address`.
4. Build `comment` as the userscript does: alt phone, notes, full raw address — each on its own line, skipping empties.
5. **Read the structured fields directly** into `gh_quantity`, `gh_expected_total`, `gh_discount_amount`, `gh_product_code`. If any required structured value is missing or non-numeric → insert but `held`, reason `missing_structured_fields`. **No label parsing, no fallback, no default quantity.**
6. Insert `orders` (country=ghana, no assigned caller) + `vdl_orders` (`needs_review`).
7. Unique-violation on `wpforms_entry_id` → `200 duplicate_ignored` (a duplicate is success — never let WPForms retry into a second order).
8. Return `200` fast; no VDL work here.

---

## 6. Edge Function `vdl-push-worker` (scheduled, every 5 min)

### 6.1 Claim (atomic)
```sql
select * from public.vdl_orders
where vdl_sync_status = 'approved'
  and (vdl_next_attempt_at is null or vdl_next_attempt_at <= now())
order by created_at asc limit 10 for update skip locked;
```
Set claimed rows to `pushing` **in the same short transaction and commit — do not hold the transaction open across the VDL HTTP call.**

### 6.2 Preflight guards (all four; any failure → `held` + specific error, no push)
Package present (`gh_quantity` & `gh_expected_total` non-null) → `missing_structured_fields`; region matches `gh_regions.name` (trimmed, case-insensitive) → `unknown_region`; product in `gh_products` and `active` → `unknown_product`; `quantity_available >= gh_quantity` → `insufficient_stock`.

### 6.3 The call
Body from §2.2 using the **structured** values; `customer_location` = operator-corrected address; `discount_amount` adjusted per `VDL_DISCOUNT_PER_UNIT`. Serialise ~1s between calls.

### 6.4 Post-call
- **200:** write `vdl_order_id`, `vdl_tracking_id`, `vdl_state_label`, five financials → sidecar. **Price guard:** if returned `amount_due_customer` differs from `gh_expected_total` by > GH₵0.01 → still `synced` (it exists in VDL now) **but fire `price_mismatch` alert** — the single most important guard.
- **401:** `auth_failed`, alert, **halt loop globally**.
- **Other 4xx:** `failed`, record body in `vdl_sync_error`, alert.
- **5xx/timeout/network:** increment attempts, exponential backoff (2, 8, 30, 120, 480 min), back to `approved`; after 5 → `failed` + alert. **Add a global circuit-breaker:** on sustained 5xx across orders, pause the loop rather than backing off each order alone.
- **Timeout is special:** a timed-out create may have succeeded. Never blind-retry — first `GET /orders?search=<phone>`, check for an order for that customer within the last hour; push only if none.

### 6.5 Alerting
Via the Phase-0 Telegram helper: any `held`/`failed`/`auth_failed`/`price_mismatch`, plus the `approved > 30 min` watchdog.

---

## 7. Edge Function `vdl-product-sync` (scheduled)

Pages `GET /products?per_page=100&page=N` until `next_page_url` is null; upsert into `gh_products` on `code`. **Run manually first, then daily** until VDL rate/size limits are known (tighten later). Surface `quantity_available` in the CRM as a **distinct read-only panel** (not inside the agent-stock model); alert when an active product drops below a configurable threshold (start 10).

---

## 8. Edge Function `vdl-status-poller` — Phase 5

After §5–§7 run cleanly. Every 20 min: select Ghana orders with `vdl_tracking_id` and non-terminal `vdl_state_label`; `GET /orders/{tracking_id}`; write `model_state.label`, refresh financials, map to a CRM chip **for display only**:

| VDL label | CRM chip |
|---|---|
| Pending | Pending |
| Confirmed | Confirmed |
| Packaged | In Transit |
| *(unobserved)* | `unknown` — surface in review, never guess |

Stop polling on a terminal state or after 30 days in `synced`.

---

## 9. CRM UI: Ghana Ready-to-Push view

Lives in the dedicated **Ghana (VDL)** nav section — the NG/GH country switcher was deprecated, so Ghana is its own top-level workspace (not a country mode of the NG screens). Gated to management roles (`caps.analytics`) until staff-country scoping lands in Phase 5. The section already hosts the read-only catalogue (Phase 1); Phase 2 adds three tabs on `vdl_sync_status`: **Needs review**, **Held**, **Synced**.

- **Needs review:** name, phone, package, region, raw address, and an **editable location field** pre-filled with the raw address. Operator corrects it against Google Maps, clicks **Approve** → `approved`. Bulk approve for rows needing no correction.
- **Held:** the specific `vdl_sync_error` with inline fixes — region dropdown for `unknown_region`, editable qty/total/discount for `missing_structured_fields`, retry once stock replenished for `insufficient_stock`.
- **Synced:** `vdl_tracking_id`, current state, financial breakdown.

This view preserves the userscript's "never save automatically" discipline. The approval step is deliberate — do not automate it away.

---

## 10. WPForms configuration (per Ghana form)

Settings → Webhooks: Request URL = `order-intake-gh`; POST/JSON; header `x-intake-secret`; mapping per §5.2.

Form fields:
1. Hidden **Product Code** (`TMDGLAS`/`5Mnrt`/`HDMT`/`CSRT`) — required.
2. Hidden **Quantity**, **Expected Total**, **Discount** — structured values (WPForms "Show Values" / hidden fields), required (discount defaults 0). *These replace label parsing.*
3. Region dropdown options must equal `gh_regions.name` exactly (incl. `Greater Accra (Tema)`).
4. Keep the existing hidden **Product Name** field for the userscript fallback.

---

## 11. Rollout

| Stage | Scope | Exit |
|---|---|---|
| 0 | Foundations (§0): deploy tooling, alerting, resolve §3.2 with one live order | Drift fixed, alerts fire, discount semantics proven |
| 1 | Schema `0016`, region seed, `vdl-product-sync` (manual→daily) | Products + stock visible |
| 2 | `order-intake-gh` + Ready-to-Push view. **No pushing.** Userscript still enters. | Every Ghana order in the CRM, correct fields, 3 consecutive days |
| 3 | `vdl-push-worker`, manual approval, one at a time | 10 pushed; every `amount_due_customer` matches `gh_expected_total`; no duplicates |
| 4 | Full volume; userscript retired but not uninstalled | 1 week clean |
| 5 | `vdl-status-poller`; then `staff.countries` + RLS (tested vs finance dashboard) | States flow in; scoping live |

Stage 2 has standalone value: Ghana orders gain CRM records + ad attribution they lack today.

**Verify before Stage 4:** duplicate webhook → one order; timeout mid-push → no second VDL order; unknown region holds; price mismatch alerts; `quantity_available` below ordered qty holds; approving 20 at once pushes exactly 20.

---

## 12. Secrets

| Name | Purpose |
|---|---|
| `VDL_API_BASE_URL` | `https://api.vdlfulfilment.net` |
| `VDL_API_TOKEN` | Bearer JWT, expires 3 Mar 2027 |
| `VDL_DISCOUNT_PER_UNIT` | `true`/`false` — from §3.2 |
| `GH_INTAKE_SECRET` | Webhook header secret |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alerting |

Service-role key stays out of the repo and frontend. Calendar reminder Feb 2027 to refresh the VDL token.
