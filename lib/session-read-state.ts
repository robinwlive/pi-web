export const SESSION_READ_TIMES_STORAGE_KEY = "pi-web:session-read-at";

export type SessionReadTimes = Record<string, number>;

export function loadSessionReadTimes(): SessionReadTimes {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_READ_TIMES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => (
        typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1])
      )),
    );
  } catch {
    return {};
  }
}

export function saveSessionReadTimes(times: SessionReadTimes): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(times);
    if (entries.length === 0) window.localStorage.removeItem(SESSION_READ_TIMES_STORAGE_KEY);
    else window.localStorage.setItem(SESSION_READ_TIMES_STORAGE_KEY, JSON.stringify(times));
  } catch {
    // Storage is a convenience only; failure only disables auto-hide timing.
  }
}

export function markSessionRead(id: string, readAt = Date.now()): SessionReadTimes {
  const times = loadSessionReadTimes();
  times[id] = readAt;
  saveSessionReadTimes(times);
  return times;
}

export function clearSessionReadTime(id: string): SessionReadTimes {
  const times = loadSessionReadTimes();
  if (id in times) {
    delete times[id];
    saveSessionReadTimes(times);
  }
  return times;
}
