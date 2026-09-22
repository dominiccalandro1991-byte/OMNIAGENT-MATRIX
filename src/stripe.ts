/**
 * Stripe webhook: verify raw body, then timestamp, then dedupe, then schema.
 * Never parse → reserialize → verify.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripeWebhookResult {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  data: unknown;
}

export class StripeWebhookVerifier {
  private secret: string;
  private toleranceSec: number;
  private seen: Set<string>;
  constructor(secret: string, toleranceSec = 300, seen = new Set<string>()) {
    this.secret = secret;
    this.toleranceSec = toleranceSec;
    this.seen = seen;
  }

  verify(rawBody: string | Buffer, header: string, nowSec = Math.floor(Date.now() / 1000)): StripeWebhookResult {
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const [k, v] = p.split("=");
        return [k.trim(), v];
      }),
    );
    const ts = Number(parts.t);
    const v1 = parts.v1;
    if (!Number.isFinite(ts) || !v1) {
      throw Object.assign(new Error("STRIPE_SIG_MISSING"), { code: "STRIPE_SIG_MISSING" });
    }
    if (Math.abs(nowSec - ts) > this.toleranceSec) {
      throw Object.assign(new Error("STRIPE_TIMESTAMP"), { code: "STRIPE_TIMESTAMP" });
    }
    const expected = createHmac("sha256", this.secret).update(`${ts}.${raw}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(v1, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw Object.assign(new Error("STRIPE_SIG_INVALID"), { code: "STRIPE_SIG_INVALID" });
    }
    let parsed: StripeWebhookResult;
    try {
      parsed = JSON.parse(raw) as StripeWebhookResult;
    } catch {
      throw Object.assign(new Error("INVALID_JSON"), { code: "INVALID_JSON" });
    }
    if (!parsed?.id || !parsed.type) {
      throw Object.assign(new Error("INVALID_SCHEMA"), { code: "INVALID_SCHEMA" });
    }
    if (this.seen.has(parsed.id)) {
      throw Object.assign(new Error("STRIPE_REPLAY"), { code: "STRIPE_REPLAY" });
    }
    this.seen.add(parsed.id);
    return parsed;
  }
}
