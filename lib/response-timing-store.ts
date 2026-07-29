import { readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import type { AgentMessage } from "./types";
import type { ResponseTiming } from "./response-timing-state";

const STORE_VERSION = 1;
const MAX_RESPONSE_TIMINGS = 500;

type ResponseTimingStore = {
  version: number;
  timings: Record<string, ResponseTiming>;
};

declare global {
  var __piResponseTimingStores: Map<string, ResponseTimingStore> | undefined;
}

function storeCache(): Map<string, ResponseTimingStore> {
  if (!globalThis.__piResponseTimingStores) globalThis.__piResponseTimingStores = new Map();
  return globalThis.__piResponseTimingStores;
}

export function responseTimingSidecarPath(sessionFile: string): string {
  return `${sessionFile}.pi-web-timings.json`;
}

function responseTimingKey(timestamp: number): string {
  return String(timestamp);
}

export function assistantMessageTimestamps(entries: unknown[]): number[] {
  const timestamps: number[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; message?: { role?: unknown; timestamp?: unknown } };
    if (candidate.type !== "message" || candidate.message?.role !== "assistant") continue;
    if (typeof candidate.message.timestamp === "number") timestamps.push(candidate.message.timestamp);
  }
  return timestamps;
}

function emptyStore(): ResponseTimingStore {
  return { version: STORE_VERSION, timings: {} };
}

function readStore(sessionFile: string): ResponseTimingStore {
  if (!sessionFile) return emptyStore();
  const cached = storeCache().get(sessionFile);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(responseTimingSidecarPath(sessionFile), "utf8")) as Partial<ResponseTimingStore>;
    const store = {
      version: STORE_VERSION,
      timings: parsed.timings && typeof parsed.timings === "object" ? parsed.timings : {},
    };
    storeCache().set(sessionFile, store);
    return store;
  } catch {
    const store = emptyStore();
    storeCache().set(sessionFile, store);
    return store;
  }
}

function trimTimings(timings: Record<string, ResponseTiming>): Record<string, ResponseTiming> {
  return Object.fromEntries(
    Object.entries(timings)
      .sort(([, a], [, b]) => b.responseEndedAt - a.responseEndedAt)
      .slice(0, MAX_RESPONSE_TIMINGS),
  );
}

function writeStore(sessionFile: string, store: ResponseTimingStore): void {
  store.timings = trimTimings(store.timings);
  storeCache().set(sessionFile, store);
  const sidecar = responseTimingSidecarPath(sessionFile);
  const temporary = `${sidecar}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(store), "utf8");
    renameSync(temporary, sidecar);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function readResponseTimings(sessionFile: string): Record<string, ResponseTiming> {
  return readStore(sessionFile).timings;
}

export function stageResponseTiming(sessionFile: string, messageTimestamp: number, timing: ResponseTiming): void {
  if (!sessionFile || !messageTimestamp) return;
  const store = readStore(sessionFile);
  store.timings[responseTimingKey(messageTimestamp)] = timing;
  store.timings = trimTimings(store.timings);
}

export function flushResponseTimings(sessionFile: string): void {
  if (!sessionFile) return;
  writeStore(sessionFile, readStore(sessionFile));
}

export function saveResponseTiming(sessionFile: string, messageTimestamp: number, timing: ResponseTiming): void {
  stageResponseTiming(sessionFile, messageTimestamp, timing);
  flushResponseTimings(sessionFile);
}

export function mergeResponseTimings(sessionFile: string, messages: AgentMessage[]): AgentMessage[] {
  const timings = readResponseTimings(sessionFile);
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.timestamp) return message;
    const timing = timings[responseTimingKey(message.timestamp)];
    return timing ? { ...message, ...timing } : message;
  });
}

export function copyResponseTimingsForTimestamps(
  sourceSessionFile: string,
  targetSessionFile: string,
  messageTimestamps: Iterable<number>,
): number {
  const source = readResponseTimings(sourceSessionFile);
  const target = emptyStore();
  let copied = 0;
  for (const timestamp of messageTimestamps) {
    const timing = source[responseTimingKey(timestamp)];
    if (!timing) continue;
    target.timings[responseTimingKey(timestamp)] = timing;
    copied++;
  }
  if (copied > 0) writeStore(targetSessionFile, target);
  return copied;
}

export function deleteResponseTimingSidecar(sessionFile: string): void {
  storeCache().delete(sessionFile);
  rmSync(responseTimingSidecarPath(sessionFile), { force: true });
}
