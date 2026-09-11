// ============================================================
// Telegram ops alerting for the Ghana / VDL pipeline (Phase 0b).
//
// Fire-and-safe: alert() NEVER throws and NEVER blocks the caller's
// critical path — a failed alert must not fail an order push. Missing
// secrets or a Telegram error is logged and swallowed.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN   from @BotFather
//   TELEGRAM_CHAT_ID     your chat/group id (message the bot once, then
//                        read it from getUpdates)
//
// Usage from an edge function:
//   import { alert } from "../_shared/alert.ts";
//   await alert("error", `price_mismatch order=${id} tracking=${t} ...`);
//
// Alert at the MOMENT a state changes (held/failed/price_mismatch/
// auth_failed), never on every poll — otherwise a stuck order pings
// forever. Include order id + tracking id + the specific error.
// ============================================================

export type AlertLevel = "info" | "warn" | "error";

const PREFIX: Record<AlertLevel, string> = {
  info: "ℹ️",  // ℹ️
  warn: "🟠",  // 🟠
  error: "🔴",  // 🔴
};

const SEND_TIMEOUT_MS = 5000;

/**
 * Send an ops alert to Telegram. Returns true if delivered, false on any
 * problem (missing secrets, non-2xx, network, timeout). Never throws.
 */
export async function alert(level: AlertLevel, message: string): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    // No secrets configured — degrade to a log so nothing crashes, but make
    // it obvious the alarm is unwired.
    console.error(`[alert:${level}] ${message} (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — not sent)`);
    return false;
  }

  const text = `${PREFIX[level]} ${message}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[alert:${level}] Telegram ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[alert:${level}] Telegram send failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
