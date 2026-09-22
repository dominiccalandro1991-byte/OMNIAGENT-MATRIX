import { Ed25519Provider, generateEd25519Pair } from "./crypto.ts";
import { MemoryTelemetryStore, TelemetryRouter } from "./TelemetryRouter.ts";
import { ReplayGuard } from "./replay.ts";

export async function runOmniBench(n = 200): Promise<Record<string, number>> {
  const keys = await generateEd25519Pair();
  const router = new TelemetryRouter(new MemoryTelemetryStore(), Ed25519Provider);
  const agent = {
    id: "ag",
    organizationId: "org",
    publicKey: keys.publicKey,
    status: "active" as const,
  };

  const t0 = performance.now();
  for (let i = 1; i <= n; i++) {
    const body = {
      id: `e${i}`,
      timestamp: Date.now(),
      organizationId: "org",
      agentId: "ag",
      executionId: "ex",
      type: "agent.heartbeat",
      sequence: i,
      payload: { i },
    };
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const sig = await Ed25519Provider.sign(raw, keys.privateKey);
    await router.ingest(raw, sig, agent);
  }
  const ingestMs = performance.now() - t0;

  const g = new ReplayGuard();
  const t1 = performance.now();
  for (let i = 1; i <= n; i++) {
    g.accept({
      organizationId: "o",
      agentId: "a",
      executionId: "e",
      eventId: `x${i}`,
      sequence: i,
      timestamp: Date.now(),
    });
  }
  const replayMs = performance.now() - t1;

  return {
    n,
    ingestMs: Math.round(ingestMs * 100) / 100,
    ingestPerSec: Math.round((n / ingestMs) * 1000),
    replayCheckMs: Math.round(replayMs * 100) / 100,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOmniBench().then((r) => console.log(JSON.stringify(r, null, 2)));
}
