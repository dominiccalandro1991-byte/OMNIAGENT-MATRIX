/**
 * Telemetry ingress: size → signature (raw bytes) → decode → schema →
 * authz → replay → route.
 */
import { Ed25519Provider, requireEd25519, type SignatureProvider } from "./crypto.ts";
import { OMNI_LIMITS } from "./limits.ts";
import { ReplayGuard } from "./replay.ts";

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  organizationId: string;
  agentId: string;
  executionId: string;
  type: string;
  sequence: number;
  payload: unknown;
  signature: string;
}

export interface AgentRecord {
  id: string;
  organizationId: string;
  publicKey: CryptoKey;
  status: "active" | "disabled";
}

export interface TelemetryStore {
  hasEvent(id: string): Promise<boolean>;
  lastSequence(agentId: string, executionId: string): Promise<number>;
  accept(e: TelemetryEvent, rawBytes: number): Promise<void>;
}

export type RouteTarget = "runtime" | "tool" | "provider" | "billing" | "telemetry";

const TYPES: Record<string, RouteTarget> = {
  "agent.heartbeat": "telemetry",
  "agent.log": "telemetry",
  "agent.thought": "runtime",
  "tool.call": "tool",
  "tool.result": "tool",
  "llm.request": "provider",
  "llm.response": "provider",
  usage: "billing",
  "execution.start": "runtime",
  "execution.end": "runtime",
};

export class TelemetryRouter {
  private store: TelemetryStore;
  private signer: SignatureProvider;
  private replay: ReplayGuard;
  private maxBytes: number;
  private maxSkewMs: number;
  constructor(
    store: TelemetryStore,
    signer: SignatureProvider = Ed25519Provider,
    replay = new ReplayGuard(),
    maxBytes = OMNI_LIMITS.MAX_EVENT_BYTES,
    maxSkewMs = OMNI_LIMITS.MAX_SKEW_MS,
  ) {
    this.store = store;
    this.signer = signer;
    this.replay = replay;
    this.maxBytes = maxBytes;
    this.maxSkewMs = maxSkewMs;
  }

  async ingest(
    raw: Uint8Array,
    signature: string,
    agent: AgentRecord,
  ): Promise<{ event: TelemetryEvent; target: RouteTarget }> {
    if (!(await this.signer.capabilityCheck())) {
      await requireEd25519();
    }
    if (raw.byteLength > this.maxBytes) {
      throw Object.assign(new Error("PAYLOAD_TOO_LARGE"), { code: "PAYLOAD_TOO_LARGE" });
    }
    if (agent.status !== "active") {
      throw Object.assign(new Error("UNAUTHORIZED_AGENT"), { code: "UNAUTHORIZED_AGENT" });
    }
    const ok = await this.signer.verify(raw, signature, agent.publicKey);
    if (!ok) {
      throw Object.assign(new Error("INVALID_SIGNATURE"), { code: "INVALID_SIGNATURE" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw Object.assign(new Error("INVALID_JSON"), { code: "INVALID_JSON" });
    }
    const e = this.schema(parsed);
    e.signature = signature;

    if (e.agentId !== agent.id) {
      throw Object.assign(new Error("AGENT_MISMATCH"), { code: "AGENT_MISMATCH" });
    }
    if (e.organizationId !== agent.organizationId) {
      throw Object.assign(new Error("ORG_MISMATCH"), { code: "ORG_MISMATCH" });
    }

    const now = Date.now();
    if (Math.abs(now - e.timestamp) > this.maxSkewMs) {
      throw Object.assign(new Error("TIMESTAMP_SKEW"), { code: "TIMESTAMP_SKEW" });
    }
    if (await this.store.hasEvent(e.id)) {
      throw Object.assign(new Error("REPLAY"), { code: "REPLAY" });
    }
    const last = await this.store.lastSequence(e.agentId, e.executionId);
    if (e.sequence <= last) {
      throw Object.assign(new Error("SEQUENCE_REGRESSION"), { code: "SEQUENCE_REGRESSION" });
    }

    this.replay.accept({
      organizationId: e.organizationId,
      agentId: e.agentId,
      executionId: e.executionId,
      eventId: e.id,
      sequence: e.sequence,
      timestamp: e.timestamp,
    }, now);

    await this.store.accept(e, raw.byteLength);
    const target = TYPES[e.type] ?? "telemetry";
    return { event: e, target };
  }

  private schema(v: unknown): TelemetryEvent {
    if (!v || typeof v !== "object") {
      throw Object.assign(new Error("INVALID_SCHEMA"), { code: "INVALID_SCHEMA" });
    }
    const o = v as Record<string, unknown>;
    if (
      typeof o.id !== "string" ||
      typeof o.organizationId !== "string" ||
      typeof o.agentId !== "string" ||
      typeof o.executionId !== "string" ||
      typeof o.type !== "string" ||
      !Number.isInteger(o.sequence) ||
      !Number.isFinite(o.timestamp)
    ) {
      throw Object.assign(new Error("INVALID_SCHEMA"), { code: "INVALID_SCHEMA" });
    }
    return {
      id: o.id,
      timestamp: o.timestamp as number,
      organizationId: o.organizationId,
      agentId: o.agentId,
      executionId: o.executionId,
      type: o.type,
      sequence: o.sequence as number,
      payload: o.payload ?? null,
      signature: "",
    };
  }
}

export class MemoryTelemetryStore implements TelemetryStore {
  readonly events = new Map<string, TelemetryEvent>();
  readonly seq = new Map<string, number>();

  async hasEvent(id: string) {
    return this.events.has(id);
  }
  async lastSequence(agentId: string, executionId: string) {
    return this.seq.get(`${agentId}:${executionId}`) ?? 0;
  }
  async accept(e: TelemetryEvent) {
    this.events.set(e.id, e);
    this.seq.set(`${e.agentId}:${e.executionId}`, e.sequence);
  }
}
