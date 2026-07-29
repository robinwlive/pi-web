import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assistantMessageTimestamps,
  copyResponseTimingsForTimestamps,
  deleteResponseTimingSidecar,
  flushResponseTimings,
  mergeResponseTimings,
  readResponseTimings,
  responseTimingSidecarPath,
  saveResponseTiming,
  stageResponseTiming,
} from "./response-timing-store.ts";

function timing(start) {
  return {
    responseRequestedAt: start - 100,
    responseStartedAt: start,
    responseEndedAt: start + 500,
  };
}

test("persists and merges timings by assistant message timestamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-timing-"));
  try {
    const sessionFile = join(dir, "session.jsonl");
    saveResponseTiming(sessionFile, 42, timing(1_000));
    const messages = mergeResponseTimings(sessionFile, [
      { role: "assistant", timestamp: 42, provider: "test", model: "test", content: [] },
      { role: "user", timestamp: 43, content: "hello" },
    ]);
    assert.equal(messages[0].responseStartedAt, 1_000);
    assert.equal(messages[1].responseStartedAt, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("staged timings are immediately readable before asynchronous disk flush", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-timing-"));
  try {
    const sessionFile = join(dir, "session.jsonl");
    stageResponseTiming(sessionFile, 42, timing(1_000));
    assert.equal(readResponseTimings(sessionFile)["42"].responseStartedAt, 1_000);
    assert.equal(existsSync(responseTimingSidecarPath(sessionFile)), false);
    flushResponseTimings(sessionFile);
    assert.equal(existsSync(responseTimingSidecarPath(sessionFile)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extracts only assistant timestamps from session entries", () => {
  assert.deepEqual(assistantMessageTimestamps([
    { type: "message", message: { role: "assistant", timestamp: 10 } },
    { type: "message", message: { role: "user", timestamp: 20 } },
    { type: "compaction", timestamp: 30 },
  ]), [10]);
});

test("caps each session at 500 and manages sidecar lifecycle", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-timing-"));
  try {
    const source = join(dir, "source.jsonl");
    const target = join(dir, "target.jsonl");
    for (let index = 1; index <= 510; index++) {
      stageResponseTiming(source, index, timing(index));
    }
    flushResponseTimings(source);
    assert.equal(Object.keys(readResponseTimings(source)).length, 500);

    const copied = copyResponseTimingsForTimestamps(source, target, [500, 501, 999]);
    assert.equal(copied, 2);
    assert.deepEqual(Object.keys(readResponseTimings(target)).sort(), ["500", "501"]);
    deleteResponseTimingSidecar(target);
    assert.deepEqual(readResponseTimings(target), {});
    assert.equal(responseTimingSidecarPath(target).endsWith(".pi-web-timings.json"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
