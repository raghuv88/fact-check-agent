import { AgentType, TokenStepUsage, TokenUsageSummary } from '../types.js';

// Anthropic pricing per token (not per million)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

function getPrice(model: string) {
  return PRICING[model] ?? PRICING['claude-sonnet-4-20250514'];
}

export type TokenUsageCallback = (usage: TokenStepUsage) => void;

/**
 * TokenTracker — one instance per fact-check job.
 *
 * Call record() after each agent step completes. It accumulates cumulative
 * totals and fires the optional onUsage callback (used by the SSE endpoint
 * to push token_usage events to the client in real time).
 */
export class TokenTracker {
  private cumulativeTokens = 0;
  private cumulativeCost = 0;
  private cumulativeDurationMs = 0;
  private stepNumber = 0;
  private steps: TokenStepUsage[] = [];
  private onUsage?: TokenUsageCallback;

  constructor(onUsage?: TokenUsageCallback) {
    this.onUsage = onUsage;
  }

  record(params: {
    step: string;
    agentType: AgentType;
    inputTokens: number;
    outputTokens: number;
    model: string;
    durationMs: number;
  }): TokenStepUsage {
    this.stepNumber++;

    const price = getPrice(params.model);
    const cost = params.inputTokens * price.input + params.outputTokens * price.output;
    const total = params.inputTokens + params.outputTokens;

    this.cumulativeTokens += total;
    this.cumulativeCost += cost;
    this.cumulativeDurationMs += params.durationMs;

    const usage: TokenStepUsage = {
      step: params.step,
      stepNumber: this.stepNumber,
      agentType: params.agentType,
      tokens: { input: params.inputTokens, output: params.outputTokens, total },
      cost,
      durationMs: params.durationMs,
      cumulative: {
        tokens: this.cumulativeTokens,
        cost: this.cumulativeCost,
        durationMs: this.cumulativeDurationMs,
      },
    };

    this.steps.push(usage);
    this.onUsage?.(usage);
    return usage;
  }

  getSummary(): TokenUsageSummary {
    return {
      totalTokens: this.cumulativeTokens,
      totalCost: this.cumulativeCost,
      totalDurationMs: this.cumulativeDurationMs,
      totalSteps: this.stepNumber,
      steps: this.steps,
    };
  }
}
