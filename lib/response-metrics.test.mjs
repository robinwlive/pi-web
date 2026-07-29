import assert from "node:assert/strict";
import test from "node:test";
import { getTurnStats } from "./response-metrics.ts";

function assistant({ requestedAt, startedAt, endedAt, input, output, cacheRead, toolCalls = 0 }) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content: Array.from({ length: toolCalls }, (_, index) => ({
      type: "toolCall",
      toolCallId: `call-${index}`,
      toolName: "test",
      input: {},
    })),
    responseRequestedAt: requestedAt,
    responseStartedAt: startedAt,
    responseEndedAt: endedAt,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("aggregates tokens and durations from the same fully timed interactions", () => {
  const stats = getTurnStats([
    { role: "user", content: "go", timestamp: 1 },
    assistant({ requestedAt: 100, startedAt: 200, endedAt: 1_200, input: 10, output: 100, cacheRead: 1_000, toolCalls: 2 }),
    assistant({ requestedAt: 2_000, startedAt: 2_300, endedAt: 4_300, input: 20, output: 200, cacheRead: 2_000, toolCalls: 1 }),
  ], 1, 3);

  assert.deepEqual(stats, {
    interactions: 2,
    toolCalls: 3,
    inputTokens: 30,
    outputTokens: 300,
    cacheTokens: 3_000,
    firstRequestAt: 100,
    firstResponseAt: 200,
    completedAt: 4_300,
    modelGenerationMs: 3_000,
    ttftMs: [100, 300],
    generationMs: [1_000, 2_000],
    callMs: [1_100, 2_300],
  });
});

test("excludes untimed interactions from both tokens and duration", () => {
  const complete = assistant({ requestedAt: 100, startedAt: 200, endedAt: 1_200, input: 10, output: 100, cacheRead: 1_000 });
  const incomplete = assistant({ requestedAt: undefined, startedAt: 2_000, endedAt: 3_000, input: 999, output: 999, cacheRead: 999 });
  const stats = getTurnStats([complete, incomplete], 0, 2);

  assert.equal(stats.interactions, 1);
  assert.equal(stats.inputTokens, 10);
  assert.equal(stats.outputTokens, 100);
  assert.equal(stats.modelGenerationMs, 1_000);
});
