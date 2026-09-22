import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Ed25519Provider, generateEd25519Pair } from "../src/crypto.ts";
import { MemoryTelemetryStore, TelemetryRouter } from "../src/TelemetryRouter.ts";
import { ReplayGuard } from "../src/replay.ts";
import { StripeWebhookVerifier } from "../src/stripe.ts";
import { WsSession } from "../src/ws-state.ts";
import { executeTool } from "../src/tools.ts";
import { normalizeUsage } from "../src/usage.ts";
import { OMNI_LIMITS } from "../src/limits.ts";

describe("Ed25519 + TelemetryRouter", () => {
  it("accepts a valid raw-byte signed event and rejects tamper/replay", async () => {
    const keys = await generateEd25519Pair();
    const store = new MemoryTelemetryStore();
    const router = new TelemetryRouter(store, Ed25519Provider);
    const body = {
      id: "evt_1",
      timestamp: Date.now(),
      organizationId: "org_1",
      agentId: "ag_1",
      executionId: "ex_1",
      type: "agent.heartbeat",
      sequence: 1,
      payload: { ok: true },
    };
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const sig = await Ed25519Provider.sign(raw, keys.privateKey);
    const agent = {
      id: "ag_1",
      organizationId: "org_1",
      publicKey: keys.publicKey,
      status: "active" as const,
    };
    const a = await router.ingest(raw, sig, agent);
    assert.equal(a.event.id, "evt_1");

    await assert.rejects(() => router.ingest(raw, sig, agent), /REPLAY/);

    const tampered = new TextEncoder().encode(JSON.stringify({ ...body, id: "evt_2", sequence: 2 }));
    await assert.rejects(() => router.ingest(tampered, sig, agent), /INVALID_SIGNATURE/);

    const body2 = { ...body, id: "evt_3", sequence: 1, timestamp: Date.now() };
    const raw2 = new TextEncoder().encode(JSON.stringify(body2));
    const sig2 = await Ed25519Provider.sign(raw2, keys.privateKey);
    await assert.rejects(() => router.ingest(raw2, sig2, agent), /SEQUENCE_REGRESSION/);
  });

  it("rejects oversized payloads before parse", async () => {
    const keys = await generateEd25519Pair();
    const store = new MemoryTelemetryStore();
    const router = new TelemetryRouter(store, Ed25519Provider);
    const raw = new Uint8Array(OMNI_LIMITS.MAX_EVENT_BYTES + 1);
    const sig = await Ed25519Provider.sign(raw, keys.privateKey);
    await assert.rejects(
      () =>
        router.ingest(raw, sig, {
          id: "ag_1",
          organizationId: "org_1",
          publicKey: keys.publicKey,
          status: "active",
        }),
      /PAYLOAD_TOO_LARGE/,
    );
  });

  it("rejects disabled agents", async () => {
    const keys = await generateEd25519Pair();
    const router = new TelemetryRouter(new MemoryTelemetryStore());
    const raw = new TextEncoder().encode("{}");
    const sig = await Ed25519Provider.sign(raw, keys.privateKey);
    await assert.rejects(
      () =>
        router.ingest(raw, sig, {
          id: "ag",
          organizationId: "o",
          publicKey: keys.publicKey,
          status: "disabled",
        }),
      /UNAUTHORIZED_AGENT/,
    );
  });
});

describe("ReplayGuard", () => {
  it("tuple uniqueness + monotonic sequence + skew", () => {
    const g = new ReplayGuard();
    const base = {
      organizationId: "o",
      agentId: "a",
      executionId: "e",
      eventId: "1",
      sequence: 1,
      timestamp: Date.now(),
    };
    g.accept(base);
    assert.throws(() => g.accept({ ...base }), /REPLAY/);
    assert.throws(
      () => g.accept({ ...base, eventId: "2", sequence: 1 }),
      /SEQUENCE_REGRESSION/,
    );
    g.accept({ ...base, eventId: "2", sequence: 2 });
    assert.throws(
      () => g.accept({ ...base, eventId: "3", sequence: 3, timestamp: Date.now() - 120_000 }),
      /STALE/,
    );
  });
});

describe("WebSocket state", () => {
  it("enforces CONNECTING → … → LIVE including SUBSCRIBING", () => {
    const s = new WsSession(4);
    s.transition("AUTHENTICATING");
    s.transition("AUTHENTICATED");
    s.transition("SUBSCRIBING");
    s.transition("SYNCING");
    s.transition("LIVE");
    assert.equal(s.state, "LIVE");
    assert.throws(() => s.transition("AUTHENTICATED"), /ILLEGAL/);
    s.transition("RECONNECTING");
    s.transition("AUTHENTICATING");
  });

  it("detects revision gaps and buffer overflow", () => {
    const s = new WsSession(2);
    s.transition("AUTHENTICATING");
    s.transition("AUTHENTICATED");
    s.transition("SUBSCRIBING");
    s.transition("SYNCING");
    s.transition("LIVE");
    assert.equal(s.apply(0, { n: 1 }), true);
    assert.equal(s.apply(0, { n: 2 }), false);
    assert.equal(s.apply(1, { n: 2 }), true);
    assert.throws(() => s.apply(2, { n: 3 }), /WS_BUFFER/);
    assert.equal(s.gap(0), true);
  });
});

describe("Stripe webhook", () => {
  it("verifies raw body HMAC and rejects replay/forgery", () => {
    const secret = "whsec_test";
    const v = new StripeWebhookVerifier(secret);
    const body = JSON.stringify({
      id: "evt_stripe_1",
      type: "invoice.paid",
      livemode: false,
      created: 1,
      data: { object: { customer: "cus_1" } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const ok = v.verify(body, `t=${ts},v1=${v1}`, ts);
    assert.equal(ok.id, "evt_stripe_1");
    assert.throws(() => v.verify(body, `t=${ts},v1=${v1}`, ts), /STRIPE_REPLAY/);
    const other = new StripeWebhookVerifier(secret);
    assert.throws(
      () => other.verify(body, `t=${ts},v1=${"00".repeat(32)}`, ts),
      /STRIPE_SIG_INVALID/,
    );
  });
});

describe("tools + usage", () => {
  it("capability-denies unknown and unauthorized tools", async () => {
    const denied = await executeTool(
      { id: "1", name: "add", arguments: { a: 1, b: 2 } },
      new Set(),
    );
    assert.equal(denied.error, "CAPABILITY_DENIED");
    const ok = await executeTool(
      { id: "2", name: "add", arguments: { a: 1, b: 2 } },
      new Set(["math.eval"]),
    );
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.result, { sum: 3 });
  });

  it("normalizes provider usage server-side", () => {
    const u = normalizeUsage(
      {
        provider: "xai",
        model: "grok-4.5",
        requestId: "r1",
        inputTokens: 1000,
        outputTokens: 500,
      },
      2000,
      5,
      15,
    );
    assert.equal(u.totalTokens, 1500);
    assert.ok(u.customerCost > u.providerCost);
  });
});
