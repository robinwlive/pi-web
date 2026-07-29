import type { AgentMessage } from "./types";

export type TurnStats = {
  interactions: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  firstRequestAt: number;
  firstResponseAt: number;
  completedAt: number;
  modelGenerationMs: number;
  ttftMs: number[];
  generationMs: number[];
  callMs: number[];
};

export function getTurnStats(messages: AgentMessage[], startIndex: number, endIndex: number): TurnStats | null {
  let interactions = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let firstRequestAt = Number.POSITIVE_INFINITY;
  let firstResponseAt = Number.POSITIVE_INFINITY;
  let completedAt = 0;
  let modelGenerationMs = 0;
  const ttftMs: number[] = [];
  const generationMs: number[] = [];
  const callMs: number[] = [];

  for (let index = startIndex; index < endIndex; index++) {
    const message = messages[index];
    if (
      message?.role !== "assistant"
      || !message.responseRequestedAt
      || !message.responseStartedAt
      || !message.responseEndedAt
      || message.responseRequestedAt > message.responseStartedAt
    ) continue;

    interactions++;
    for (const block of message.content) {
      if (block.type === "toolCall") toolCalls++;
    }
    inputTokens += message.usage?.input ?? 0;
    outputTokens += message.usage?.output ?? 0;
    cacheTokens += message.usage?.cacheRead ?? 0;

    const generationDuration = message.responseEndedAt - message.responseStartedAt;
    firstRequestAt = Math.min(firstRequestAt, message.responseRequestedAt);
    firstResponseAt = Math.min(firstResponseAt, message.responseStartedAt);
    completedAt = Math.max(completedAt, message.responseEndedAt);
    modelGenerationMs += generationDuration;
    ttftMs.push(message.responseStartedAt - message.responseRequestedAt);
    generationMs.push(generationDuration);
    callMs.push(message.responseEndedAt - message.responseRequestedAt);
  }

  return interactions > 0
    ? {
        interactions,
        toolCalls,
        inputTokens,
        outputTokens,
        cacheTokens,
        firstRequestAt,
        firstResponseAt,
        completedAt,
        modelGenerationMs,
        ttftMs,
        generationMs,
        callMs,
      }
    : null;
}
