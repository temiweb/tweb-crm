# Infinistores CRM — System Handbook

*A complete reference for how the CRM works, for SOPs, staff training, and record-keeping.*
*Last updated: 2026-07-01.*

---

## 1. What this system is

The Infinistores CRM is a web app for managing cash-on-delivery (COD) e-commerce orders from intake through to delivery. It replaces the old CSV-and-spreadsheet workflow with:

- **Automatic order intake** from your WPForms landing pages
- A **call-centre workflow** for confirming orders
- **Delivery-agent and inventory tracking**
- **Role-based logins** so staff see only what they should
- **Performance dashboards** for callers and agents

**Where it lives:** https://tweb-crm.vercel.app
**Works on:** any phone, tablet, or computer browser (mobile-first — designed for callers on phones).
**Scope:** used for **Nigeria** operations. (A Ghana switch exists but Ghana is handled by your delivery partner's own dashboard.)

**Behind the scenes (for your records):** React front-end hosted on Vercel; Supabase (Postgres) database and authentication; a Supabase Edge Function receives WPForms webhooks. All data access is protected by database-level security (Row-Level Security), not just the interface.

---

## 2. Logging in & accounts

- Every staff member has their **own email + password** login (no shared PIN).
- Staff are added by invite: they receive an email, click it, and **set their own password**. Nobody handles or stores anyone's password.
- Sessions stay logged in and refresh automatically; use the **Lock/Log-out** button to sign out.

### Roles & what each can do

| Capability | Admin (owner) | Caller | Viewer | *Manager*¹ | *Accountant*¹ |
|---|:--:|:--:|:--:|:--:|:--:|
| See orders | All | **Only their own assigned** | All | All | All |
| Confirm / update / assign orders | ✅ | ✅ (their own) | — | ✅ | — |
| Create / import / delete orders | ✅ | — | — | ✅ | — |
| Inventory (warehouse, waybills, transfers) | Edit | View | View | Edit | View |
| Delivery agents | Edit | View | View | Edit | View |
| Analytics & revenue figures | ✅ | — (hidden) | — | ✅ | ✅ |
| Manage staff (invite/roles) | ✅ | — | — | — | — |
| Settings & WhatsApp templates | ✅ | — | — | ✅ | — |

¹ *Manager and Accountant are built into the design and can be switched on when you need them.*

**Key security fact:** a Caller can only ever see and edit **orders assigned to them** — enforced in the database itself, so it holds even outside the app.

### Adding a staff member (Admin)
1. **Staff → Add staff.**
2. Enter their name, email, phone, and **role**.
3. Send invite. They get an email → set their password → land in the app with the right access.
4. To pause someone (e.g., they're on leave): **Staff → Deactivate**. To change their role: use the role dropdown. To remove them: the trash icon.

---

## 3. How orders come in

Orders reach the CRM three ways:

1. **Automatically from WPForms (main channel).** Each product landing-page form sends every submission straight into the CRM in real time — 24/7, whether anyone is at the dashboard or not. Product name, customer details, package, price, delivery preference, and payment option all come through.
   - **Duplicate protection:** a repeated/retried submission on the same day won't create a double; a genuine re-order on a later day is kept as a new order.
2. **Manual entry (Admin):** Orders → **New order**.
3. **CSV import (Admin, fallback):** Orders → **Import CSV** — for old/bulk data. *(Avoid importing orders that already arrive via the webhook, to prevent duplicates.)*

### Auto-assignment to callers
The moment an order arrives from WPForms, the system **auto-assigns it to a caller**:
- **One active caller:** every order goes to them.
- **Several active callers:** each order goes to whoever currently has the **fewest open orders** — the workload self-balances.
- **No active callers:** the order stays **unassigned** and waits in the admin's queue (nothing is lost).

This is what lets orders start moving before you touch anything. You can always override it (Section 5).

---

## 4. Order statuses (the heart of the workflow)

There are 16 statuses, grouped into four clusters. Callers set these as they work each order.

| Group | Statuses | Meaning |
|---|---|---|
| **In progress** | Pending · Confirmed · In Transit · Call Back · Follow Up · Postponed | Order is live and being worked |
| **Couldn't reach** | Not Reachable · Number Busy · Switched Off · Not Answering · Not Available | Phone attempt failed (choose the specific reason) |
| **Didn't go through** | Cancelled · Rejected · Failed Delivery · Out of Stock | Order won't complete |
| **Completed** | Delivered | Delivered **and cash collected** |

**What each means in practice:**
- **Pending** — new, not yet confirmed.
- **Confirmed** — customer agreed on the confirmation call; ready to dispatch.
- **In Transit** — dispatched to a delivery agent, on the way.
- **Call Back / Follow Up** — needs another contact attempt / a decision chase.
- **Postponed** — customer wants it later; reserved for them.
- **Not Reachable / Number Busy / Switched Off / Not Answering / Not Available** — the "couldn't reach" reasons; pick the accurate one (it feeds the performance report).
- **Cancelled** — order called off. **Rejected** — customer declined.
- **Failed Delivery** — delivery attempt didn't succeed.
- **Out of Stock** — item unavailable.
- **Delivered** — received by customer and **payment collected** (see Section 6).

Every status change is **timestamped and logged** (visible as "Status history" inside each order), and key milestones (confirmed, dispatched, delivered) are recorded for reporting.

---

## 5. The Caller workflow (SOP-ready)

A caller's job: take assigned orders from "Pending" to "Delivered," logging each step.

**Step by step:**
1. **Log in** → you land on **Orders**, showing only *your* assigned orders.
2. Use the **My queue** toggle (default): shows only orders needing a call — Pending, Call Back, Postponed, Follow Up — **oldest first**. ("All mine" shows everything assigned to you.)
3. **Open an order** to see the customer, product, amount, address, delivery date, and notes.
4. **Call the customer** — tap the **Call** button (opens your phone dialer with their number). If you can't reach them, set the matching status (Number Busy / Not Answering / etc.).
5. **Log the outcome** using the status dropdown:
   - Reached and agreed → **Confirmed**.
   - Needs another try → **Call Back / Follow Up**.
   - Wants it later → **Postponed**.
   - Declined / calling off → **Rejected / Cancelled**.
6. **Dispatch a confirmed order:**
   - **Assign a delivery agent** on the order (so stock is tracked — see Section 7).
   - Tap **Copy** to copy a clean, formatted order summary and **paste it into your delivery WhatsApp group**.
   - Set status to **In Transit**.
7. **Close it out:** when the agent confirms the customer received it and paid → set **Delivered**. If it failed → **Failed Delivery**.

**Messaging the customer:** the **WhatsApp** button opens a pre-written message (per status) with the customer's name, product, and amount already filled in — just send.

**Golden rule:** only mark **Delivered** once the agent confirms hand-over and payment. Never mark it speculatively (Section 6 explains why).

---

## 6. "Delivered" = money collected (COD)

Because the business is cash-on-delivery, **"Delivered" already means the cash was collected** — there's no separate "paid" step to track. This keeps your numbers honest:

- The delivered count = cash collected.
- Revenue figures in Analytics are based on delivered orders.
- **Therefore: only set Delivered when the agent confirms hand-over + payment.** Marking it early would overstate revenue.

---

## 7. Delivery agents & inventory

Delivery agents hold stock in the field and deliver to customers.

**Inventory has sub-sections (Inventory tab):**
- **Products** — each product's **warehouse quantity** and total held **with agents**.
- **Agent stock** — how many units each agent currently holds.
- **Waybills** — move stock **from the warehouse to an agent**. Marking a waybill *Delivered* transfers the units into that agent's stock.
- **Transfers** — move stock **from one agent to another** (rebalancing).
- **Buy stock** — record incoming purchases (adds to warehouse).
- **Faulty stock** — write off damaged/returned units (from warehouse or an agent).

**How stock moves automatically:**
- Buy stock → **warehouse goes up**.
- Waybill marked delivered → **warehouse down, agent up**.
- Transfer → moves between two agents.
- **Order marked Delivered → the assigned agent's stock of that product goes down by the delivered quantity.**
- Faulty → removed from wherever it was.

> This is why callers assign a delivery agent before dispatch: it links the order to the right agent so stock deducts correctly on delivery.

**Agent performance (Agents tab):** per agent — assigned, delivered, in-transit, cancelled, **delivery rate %**, units in hand, and revenue delivered, plus a summary strip across all agents.

---

## 8. Assigning & reassigning orders (Admin)

Auto-assignment (Section 3) is the default, but the admin stays in full control:

- **See who has what:** the **Caller** filter on Orders (All callers · No caller · each caller).
- **Reassign:** select orders → **Assign caller…** → pick a different caller.
- **Unassign:** same control → **— Unassign —** (sends orders back to the pool).
- **Cover an absence:** **Deactivate** the caller (Staff tab) — this instantly stops *new* orders routing to them — then reassign their open orders to whoever's covering. Reactivate when they return.
- **Delivery-agent assignment** is separate and set on each order (used for stock/delivery).

Admins and managers always see **every** order regardless of assignment.

---

## 9. Messaging: WhatsApp, Call, and Copy

- **Call** — opens the phone dialer with the customer's number (great on mobile).
- **WhatsApp** — opens WhatsApp with a pre-written, status-specific message, auto-filled with the customer's details. Send as-is or tweak.
- **Copy** — copies a clean order summary (name, phone, WhatsApp, address, landmark, amount, note) to paste into your delivery WhatsApp group.

**Editing the messages (Admin → Messages):** each status has its own template. Edit the text, then **Save** (a Save button appears when you've made changes). Use placeholders like `{name}`, `{product}`, `{price}`, `{address}`, `{agent}` — they're replaced with the real order details when sent. Press **Enter** for line breaks; WhatsApp keeps your spacing.

---

## 10. Analytics & monitoring (Admin)

- **Period filter** (Today / Week / Month / 30d / 90d / All time / Custom) drives every figure.
- **KPI cards:** Orders, Delivered (+ rate), Units sold, Pending, Failed, Revenue, Fees, Net. *(Callers never see the money figures.)*
- **Delivery funnel:** placed → reached → delivered, showing where orders leak.
- **Status breakdown, revenue, and by-state** charts.
- **Caller effectiveness scoreboard:** per caller — assigned, delivery rate %, lost-on-call %, lost-at-delivery %, and in-progress. *(Lost-on-call reflects phone skill; lost-at-delivery is more about the agent/area.)* Doubles as a probation/performance scorecard.
- **Stale-in-transit alert:** any order stuck In Transit for over **48 hours** surfaces as a chase-up banner on Orders (for the admin and the assigned caller).

---

## 11. Everyday tasks — quick reference

| I want to… | Where |
|---|---|
| Onboard a caller | Staff → Add staff (they set their own password by email) |
| Pause a caller who's away | Staff → Deactivate |
| See a specific caller's orders | Orders → Caller filter |
| Reassign / unassign orders | Orders → select → Assign caller / Unassign |
| Add/adjust product warehouse stock | Inventory → Products / Buy stock |
| Send stock to an agent | Inventory → Waybills → mark delivered |
| Move stock between agents | Inventory → Transfers |
| Write off damaged stock | Inventory → Faulty stock |
| Edit customer messages | Messages → edit → Save |
| Check performance | Analytics (callers & funnel) · Agents (delivery agents) |

---

## 12. Data safety & operations (for your records)

- **Every table is protected** by database-level security. Logged-out or unauthorised access returns nothing; callers are limited to their own orders at the database level.
- **Two environments:** a live/production database and a separate **staging** copy used to test changes before they reach real data. Changes that touch the database schema are always rehearsed on staging first.
- **Order intake and staff invites** run through server-side functions using a protected key that never touches the browser.
- **No customer data or passwords** are stored insecurely; passwords are managed by the authentication provider.

---

## 13. Status → performance mapping (reference)

Used by the caller effectiveness scoreboard:

| Stage | Statuses |
|---|---|
| In progress (still open) | Pending, Call Back, Postponed, Follow Up, Confirmed, In Transit |
| Delivered | Delivered |
| Lost on call (caller-influenced) | Not Reachable, Number Busy, Switched Off, Not Answering, Not Available, Cancelled, Rejected |
| Lost at delivery (agent/area) | Failed Delivery |
| Unfulfilled | Out of Stock |

---

*End of handbook. For SOPs, Sections 5 (Caller workflow) and 8 (Assigning/reassigning) are the most directly liftable; Sections 2 and 11 make good training quick-references.*
