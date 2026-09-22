# OMNIAGENT-MATRIX

Enterprise AI workforce orchestration. Independent of NexusFlow Engine.

Ed25519 over raw bytes. If Ed25519 is unavailable the service fails closed.

```bash
node --experimental-strip-types --test tests/*.test.ts
node --experimental-strip-types src/bench.ts
```

Measured 2026-09-22: 200 signed ingestions in 92.75 ms (~2156/s); 200 replay checks in 0.13 ms.

Inference uses server-side xAI (grok-4.5) when XAI_API_KEY is present. Live OpenRouter is UNVERIFIED until OPENROUTER_API_KEY is configured.
