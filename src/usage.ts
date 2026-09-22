export interface ProviderUsage {
  provider: string;
  model: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
}

export interface BillableUsage extends ProviderUsage {
  usageId: string;
  totalTokens: number;
  providerCost: number;
  markup: number;
  customerCost: number;
  timestamp: number;
}

/** Markup is applied server-side from provider-reported usage only. */
export function normalizeUsage(
  u: ProviderUsage,
  markupBps: number,
  usdPerMillionIn: number,
  usdPerMillionOut: number,
): BillableUsage {
  const providerCost =
    (u.inputTokens / 1_000_000) * usdPerMillionIn +
    (u.outputTokens / 1_000_000) * usdPerMillionOut;
  const markup = providerCost * (markupBps / 10_000);
  return {
    ...u,
    usageId: `use_${u.requestId}`,
    totalTokens: u.inputTokens + u.outputTokens,
    providerCost: round6(providerCost),
    markup: round6(markup),
    customerCost: round6(providerCost + markup),
    timestamp: Date.now(),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
