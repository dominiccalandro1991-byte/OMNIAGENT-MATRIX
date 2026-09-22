export type Capability =
  | "market.read"
  | "market.quote"
  | "ledger.read"
  | "web.search"
  | "math.eval"
  | "time.now";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  ok: boolean;
  capability: Capability;
  result: unknown;
  error?: string;
  durationMs: number;
}

const TOOLS: Record<
  string,
  { capability: Capability; run: (args: Record<string, unknown>) => unknown }
> = {
  clock: {
    capability: "time.now",
    run: () => ({ iso: new Date().toISOString() }),
  },
  add: {
    capability: "math.eval",
    run: (args) => {
      const a = Number(args.a);
      const b = Number(args.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("INVALID_ARGS");
      return { sum: a + b };
    },
  },
};

export async function executeTool(
  call: ToolCall,
  granted: Set<Capability>,
  timeoutMs = 4000,
): Promise<ToolResult> {
  const started = Date.now();
  const spec = TOOLS[call.name];
  if (!spec) {
    return {
      id: call.id,
      ok: false,
      capability: "math.eval",
      result: null,
      error: "UNKNOWN_TOOL",
      durationMs: Date.now() - started,
    };
  }
  if (!granted.has(spec.capability)) {
    return {
      id: call.id,
      ok: false,
      capability: spec.capability,
      result: null,
      error: "CAPABILITY_DENIED",
      durationMs: Date.now() - started,
    };
  }
  try {
    const result = await Promise.race([
      Promise.resolve(spec.run(call.arguments)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), timeoutMs)),
    ]);
    return {
      id: call.id,
      ok: true,
      capability: spec.capability,
      result,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      id: call.id,
      ok: false,
      capability: spec.capability,
      result: null,
      error: err instanceof Error ? err.message : "TOOL_FAILED",
      durationMs: Date.now() - started,
    };
  }
}
