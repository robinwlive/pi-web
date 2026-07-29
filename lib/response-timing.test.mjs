import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLatencyStats,
  formatMillisecondsTime,
  formatResponseDuration,
  formatResponseTimeline,
  formatTokensPerSecond,
} from "./response-timing.ts";

test("formats durations across seconds, minutes, and hours", () => {
  assert.equal(formatResponseDuration(842), "0.842s");
  assert.equal(formatResponseDuration(64_112), "1m 04.112s");
  assert.equal(formatResponseDuration(3_723_004), "1h 02m 03.004s");
});

test("formats a compact first-response to completion timeline", () => {
  assert.equal(
    formatResponseTimeline(2_000, 3_000),
    `${formatMillisecondsTime(2_000)} → ${formatMillisecondsTime(3_000)}`,
  );
});

test("calculates output throughput from token and generation duration", () => {
  assert.equal(formatTokensPerSecond(1_237, 19_626), "63.0 t/s");
  assert.equal(formatTokensPerSecond(0, 1_000), null);
  assert.equal(formatTokensPerSecond(100, 0), null);
});

test("hides P95 for small samples while retaining median and bounds", () => {
  const stats = formatLatencyStats([1_000, 2_000, 3_000]);
  assert.equal(stats, "avg 2.000s · P50 2.000s · min 1.000s · max 3.000s");
});

test("includes P95 once there are enough samples", () => {
  const stats = formatLatencyStats(Array.from({ length: 20 }, (_, index) => (index + 1) * 1_000));
  assert.ok(stats?.includes("P95 19.000s"));
});
