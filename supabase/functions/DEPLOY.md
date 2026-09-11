# Edge Functions — Deploy from the Repo (Phase 0a)

Functions were historically **pasted into the Supabase dashboard**, so the deployed copy and the repo copy can silently drift (review item #18). Before adding the four Ghana/VDL functions, make the **repo the single source of truth** and deploy with the CLI.

## One-time setup

```bash
# 1. Install the Supabase CLI (if not already):  https://supabase.com/docs/guides/cli
supabase --version

# 2. Initialise config in this repo (creates supabase/config.toml). Commit it.
supabase init

# 3. Link this repo to the PROD project (find the ref in the dashboard URL /project/<ref>).
supabase link --project-ref <prod-project-ref>
```

## Deploying a function

```bash
supabase functions deploy <name>          # e.g. order-intake-gh, vdl-push-worker
# functions that take a non-Supabase webhook (WPForms, VDL) skip JWT verification:
supabase functions deploy order-intake-gh --no-verify-jwt
```

The deployed code is now exactly what is in `supabase/functions/<name>/`. **Stop pasting into the dashboard** — edit here, deploy from here.

> Migrating the existing `wpforms-intake`: deploy it once from the repo (`--no-verify-jwt`, its current setting) and confirm Nigerian orders still land. This proves the pipeline on a function you already trust before the Ghana functions depend on it. Do **not** change its behaviour.

## Secrets

Set once per project; never commit them.

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
# later phases:
supabase secrets set VDL_API_BASE_URL=https://api.vdlfulfilment.net VDL_API_TOKEN=... \
                     GH_INTAKE_SECRET=... VDL_DISCOUNT_PER_UNIT=false
supabase secrets list
```

`TELEGRAM_CHAT_ID`: create a bot with **@BotFather**, send it any message (or add it to a group and post once), then read the id from
`https://api.telegram.org/bot<TOKEN>/getUpdates` → `result[].message.chat.id`.

## Prove alerting works (Phase 0b exit)

```bash
supabase functions deploy alert-test
curl -X POST "$SUPABASE_URL/functions/v1/alert-test" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# -> a "🟠 alert-test: ..." message should arrive in your Telegram chat within seconds
supabase functions delete alert-test          # remove the throwaway once confirmed
```

The shared helper lives in `supabase/functions/_shared/alert.ts` and is imported by every pipeline function as `import { alert } from "../_shared/alert.ts"`.
