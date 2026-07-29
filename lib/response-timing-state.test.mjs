import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RESPONSE_TIMING_STATE,
  observeResponseTiming,
} from "./response-timing-state.ts";

test("tracks the real first-turn event sequence without losing request time", () => {
  let state = { ...EMPTY_RESPONSE_TIMING_STATE };

  ({ state } = observeResponseTiming(state, { type: "agent_start" }, 1_000));
  ({ state } = observeResponseTiming(state, { type: "turn_start" }, 1_100));
  ({ state } = observeResponseTiming(state, { type: "message_start", message: { role: "user", content: [] } }, 1_110));
  ({ state } = observeResponseTiming(state, { type: "message_end", message: { role: "user", content: [] } }, 1_120));
  ({ state } = observeResponseTiming(state, { type: "provider_request_start" }, 1_300));

  const firstContent = observeResponseTiming(state, {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
  }, 1_500);
  state = firstContent.state;
  assert.equal(firstContent.event.message.responseRequestedAt, 1_300);
  assert.equal(firstContent.event.message.responseStartedAt, 1_500);

  const completed = observeResponseTiming(state, {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
  }, 2_000);
  assert.deepEqual(completed.completedTiming, {
    responseRequestedAt: 1_300,
    responseStartedAt: 1_500,
    responseEndedAt: 2_000,
  });
  assert.deepEqual(completed.state, EMPTY_RESPONSE_TIMING_STATE);
});

test("ignores empty assistant starts until visible content arrives", () => {
  let state = observeResponseTiming(EMPTY_RESPONSE_TIMING_STATE, { type: "turn_start" }, 10).state;
  const empty = observeResponseTiming(state, {
    type: "message_start",
    message: { role: "assistant", content: [] },
  }, 20);
  assert.equal(empty.state.startedAt, null);

  const thinking = observeResponseTiming(empty.state, {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "work" }] },
  }, 30);
  assert.equal(thinking.state.startedAt, 30);
});
