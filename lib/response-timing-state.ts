export type ResponseTiming = {
  responseRequestedAt?: number;
  responseStartedAt: number;
  responseEndedAt: number;
};

export type ResponseTimingState = {
  requestedAt: number | null;
  startedAt: number | null;
};

type TimedMessage = {
  role?: string;
  content?: unknown;
  responseRequestedAt?: number;
  responseStartedAt?: number;
  responseEndedAt?: number;
};

export type TimingEvent = {
  type: string;
  message?: TimedMessage;
  [key: string]: unknown;
};

export type TimingTransition = {
  state: ResponseTimingState;
  event: TimingEvent;
  completedTiming?: ResponseTiming;
};

export const EMPTY_RESPONSE_TIMING_STATE: ResponseTimingState = {
  requestedAt: null,
  startedAt: null,
};

function hasAssistantResponseContent(message: TimedMessage): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return false;
  return message.content.some((block) => {
    if (!block || typeof block !== "object") return false;
    const item = block as { type?: unknown; text?: unknown; thinking?: unknown };
    if (item.type === "text") return typeof item.text === "string" && item.text.length > 0;
    if (item.type === "thinking") return typeof item.thinking === "string" && item.thinking.length > 0;
    return item.type === "toolCall" || item.type === "image";
  });
}

export function observeResponseTiming(
  state: ResponseTimingState,
  event: TimingEvent,
  observedAt: number,
): TimingTransition {
  if (event.type === "agent_start" || event.type === "agent_end") {
    return { state: { ...EMPTY_RESPONSE_TIMING_STATE }, event };
  }

  if (event.type === "turn_start" || event.type === "provider_request_start") {
    return { state: { requestedAt: observedAt, startedAt: null }, event };
  }

  if ((event.type === "message_start" || event.type === "message_update") && event.message) {
    if (!hasAssistantResponseContent(event.message)) return { state, event };
    const startedAt = state.startedAt ?? observedAt;
    return {
      state: { ...state, startedAt },
      event: {
        ...event,
        message: {
          ...event.message,
          ...(state.requestedAt !== null ? { responseRequestedAt: state.requestedAt } : {}),
          responseStartedAt: startedAt,
        },
      },
    };
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    if (state.startedAt === null) {
      return { state: { ...EMPTY_RESPONSE_TIMING_STATE }, event };
    }
    const completedTiming: ResponseTiming = {
      ...(state.requestedAt !== null ? { responseRequestedAt: state.requestedAt } : {}),
      responseStartedAt: state.startedAt,
      responseEndedAt: observedAt,
    };
    return {
      state: { ...EMPTY_RESPONSE_TIMING_STATE },
      event: { ...event, message: { ...event.message, ...completedTiming } },
      completedTiming,
    };
  }

  return { state, event };
}
