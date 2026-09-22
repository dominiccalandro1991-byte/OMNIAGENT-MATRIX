import { OMNI_LIMITS } from "./limits.ts";

export interface ReplayTuple {
  organizationId: string;
  agentId: string;
  executionId: string;
  eventId: string;
  sequence: number;
  timestamp: number;
}

export class ReplayGuard {
  private readonly seen = new Map<string, number>();
  private readonly lastSeq = new Map<string, number>();

  key(t: ReplayTuple): string {
    return `${t.organizationId}:${t.agentId}:${t.executionId}`;
  }

  accept(t: ReplayTuple, now = Date.now()): void {
    if (t.timestamp < now - OMNI_LIMITS.MAX_SKEW_MS) {
      throw Object.assign(new Error("STALE_EVENT"), { code: "STALE_EVENT" });
    }
    if (t.timestamp > now + OMNI_LIMITS.MAX_FUTURE_MS) {
      throw Object.assign(new Error("FUTURE_EVENT"), { code: "FUTURE_EVENT" });
    }
    if (this.seen.has(t.eventId)) {
      throw Object.assign(new Error("REPLAY"), { code: "REPLAY" });
    }
    const k = this.key(t);
    const last = this.lastSeq.get(k) ?? 0;
    if (t.sequence <= last) {
      throw Object.assign(new Error("SEQUENCE_REGRESSION"), {
        code: "SEQUENCE_REGRESSION",
      });
    }
    this.seen.set(t.eventId, t.timestamp);
    this.lastSeq.set(k, t.sequence);
  }

  last(organizationId: string, agentId: string, executionId: string): number {
    return this.lastSeq.get(`${organizationId}:${agentId}:${executionId}`) ?? 0;
  }

  has(eventId: string): boolean {
    return this.seen.has(eventId);
  }
}
