"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { ChatWindow } from "./ChatWindow";
import { useIsMobile } from "@/hooks/useIsMobile";
import { loadSessionReadTimes, saveSessionReadTimes, type SessionReadTimes } from "@/lib/session-read-state";

const UNREAD_STORAGE_KEY = "pi-web:unread-session-ids";
const PINNED_STORAGE_KEY = "pi-web:board-pinned-session-ids";
const RECENT_ACTIVITY_MS = 30 * 60 * 1000;
const READ_AUTO_HIDE_MS = 30 * 60 * 1000;

function loadIds(key: string): Set<string> {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveIds(key: string, ids: Set<string>): void {
  try {
    if (ids.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage is a convenience only; the session data remains authoritative.
  }
}

function relativeTime(value: string): string {
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function workspaceName(session: SessionInfo): string {
  const path = session.projectRoot ?? session.cwd;
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function sessionTitle(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage.trim() || "Untitled session";
}

function isRecent(session: SessionInfo, now: number): boolean {
  return now - new Date(session.modified).getTime() < RECENT_ACTIVITY_MS;
}

interface Props {
  onBack: () => void;
}

export function AgentBoard({ onBack }: Props) {
  const isMobile = useIsMobile();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => loadIds(UNREAD_STORAGE_KEY));
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadIds(PINNED_STORAGE_KEY));
  const [readTimes, setReadTimes] = useState<SessionReadTimes>(() => loadSessionReadTimes());
  const [now, setNow] = useState(() => Date.now());
  const previousRunningIdsRef = useRef<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { sessions?: SessionInfo[]; runningSessionIds?: string[] };
      const nextSessions = data.sessions ?? [];
      const ids = new Set(nextSessions.map((session) => session.id));
      setSessions(nextSessions);
      setRunningIds(new Set(data.runningSessionIds ?? []));
      setUnreadIds((current) => new Set([...current].filter((id) => ids.has(id))));
      setPinnedIds((current) => new Set([...current].filter((id) => ids.has(id))));
      setReadTimes((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id)));
        saveSessionReadTimes(next);
        return next;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  useEffect(() => { saveIds(PINNED_STORAGE_KEY, pinnedIds); }, [pinnedIds]);

  useEffect(() => {
    const source = new EventSource("/api/agent/running/events");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; runningSessionIds?: string[] };
        if (data.type === "running") {
          const nextRunning = new Set(data.runningSessionIds ?? []);
          const previousRunning = previousRunningIdsRef.current;
          const completed = [...previousRunning].filter((id) => !nextRunning.has(id));
          const newlyRunning = [...nextRunning].filter((id) => !previousRunning.has(id));
          setRunningIds(nextRunning);
          if (completed.length > 0 || newlyRunning.length > 0) {
            setUnreadIds((current) => {
              const next = new Set(current);
              newlyRunning.forEach((id) => next.delete(id));
              completed.forEach((id) => next.add(id));
              saveIds(UNREAD_STORAGE_KEY, next);
              return next;
            });
            setReadTimes((current) => {
              const next = { ...current };
              [...completed, ...newlyRunning].forEach((id) => delete next[id]);
              saveSessionReadTimes(next);
              return next;
            });
          }
          previousRunningIdsRef.current = nextRunning;
        }
      } catch {
        // Ignore malformed status frames; the periodic session refresh remains available.
      }
    };
    return () => source.close();
  }, []);

  const visibleSessions = useMemo(() => sessions.filter((session) => {
    const running = runningIds.has(session.id);
    const unread = unreadIds.has(session.id);
    const pinned = pinnedIds.has(session.id);
    const readAt = readTimes[session.id];
    const hasNewActivitySinceRead = readAt !== undefined && new Date(session.modified).getTime() > readAt;
    const readExpired = readAt !== undefined && now - readAt >= READ_AUTO_HIDE_MS && !hasNewActivitySinceRead;
    if (readExpired && !running && !unread && !pinned) return false;
    return running || unread || pinned || isRecent(session, now) || readAt !== undefined;
  }), [now, pinnedIds, readTimes, runningIds, sessions, unreadIds]);

  const boardStats = useMemo(() => ({
    running: [...runningIds].length,
    unread: sessions.filter((session) => unreadIds.has(session.id) && !runningIds.has(session.id)).length,
    total: sessions.length,
    visible: visibleSessions.length,
  }), [runningIds, sessions, unreadIds, visibleSessions.length]);

  const orderedSessions = useMemo(() => {
    const priority = (session: SessionInfo): number => {
      if (unreadIds.has(session.id) && !runningIds.has(session.id)) return 0;
      if (runningIds.has(session.id)) return 1;
      if (pinnedIds.has(session.id)) return 2;
      return 3;
    };
    return [...visibleSessions].sort((left, right) => {
      const priorityDiff = priority(left) - priority(right);
      return priorityDiff !== 0 ? priorityDiff : right.modified.localeCompare(left.modified);
    });
  }, [pinnedIds, runningIds, unreadIds, visibleSessions]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setUnreadIds((current) => {
      const next = new Set(current);
      next.delete(id);
      saveIds(UNREAD_STORAGE_KEY, next);
      return next;
    });
    setReadTimes((current) => {
      const next = { ...current, [id]: Date.now() };
      saveSessionReadTimes(next);
      return next;
    });
  }, []);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{ minHeight: 42, display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "0 8px" : "0 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", position: "sticky", top: 0, zIndex: 2, overflowX: "auto" }}>
        <button type="button" onClick={onBack} title="Back to Pi Web" style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 4px", border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 10, flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 9 : 13, paddingLeft: 8, borderLeft: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, whiteSpace: "nowrap" }}>
          <span title={`${boardStats.running} running`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><SessionStateIcon running unread={false} /><strong style={{ color: "var(--text)", fontWeight: 650 }}>{boardStats.running}</strong></span>
          <span title={`${boardStats.unread} need reading`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 8, height: 8, background: "var(--accent)" }} /><strong style={{ color: "var(--text)", fontWeight: 650 }}>{boardStats.unread}</strong></span>
          <span title={`${boardStats.visible} sessions on the board out of ${boardStats.total} total`}><strong style={{ color: "var(--text)", fontWeight: 650 }}>{boardStats.visible}</strong>/{boardStats.total} sessions</span>
        </div>
      </header>

      <main style={{ maxWidth: 1640, margin: "0 auto", padding: isMobile ? "10px 8px 28px" : "12px 18px 40px" }}>

        {error && <div style={{ marginBottom: 14, padding: "8px 10px", border: "1px solid rgba(239,68,68,.35)", color: "#ef4444", background: "color-mix(in srgb, #ef4444 8%, var(--bg))", fontFamily: "var(--font-mono)", fontSize: 11 }}>Unable to refresh sessions: {error}</div>}
        {loading ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading sessions...</div> : orderedSessions.length === 0 ? <div style={{ padding: "56px 12px", color: "var(--text-muted)", textAlign: "center", fontSize: 13 }}>No sessions currently need attention.</div> : (
          <div onClick={() => setExpandedId(null)} style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(12, minmax(0, 1fr))", gridAutoFlow: "dense", gap: 10, alignItems: "start" }}>
            {orderedSessions.map((session) => <BoardCard key={session.id} session={session} mobile={isMobile} expanded={expandedId === session.id} running={runningIds.has(session.id)} unread={unreadIds.has(session.id)} pinned={pinnedIds.has(session.id)} onToggle={() => setExpandedId((current) => current === session.id ? null : session.id)} onPin={() => togglePin(session.id)} onMarkRead={() => markRead(session.id)} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function BoardCard({ session, mobile, expanded, running, unread, pinned, onToggle, onPin, onMarkRead }: { session: SessionInfo; mobile: boolean; expanded: boolean; running: boolean; unread: boolean; pinned: boolean; onToggle: () => void; onPin: () => void; onMarkRead: () => void }) {
  const handleTitleClick = () => {
    if (!expanded && unread) onMarkRead();
    onToggle();
  };
  return (
    <article onClick={(event) => event.stopPropagation()} style={{ gridColumn: mobile ? "span 1" : expanded ? "span 8" : "span 3", minWidth: 0, minHeight: expanded ? 510 : 182, padding: expanded ? 12 : 13, border: `${expanded ? 2 : 1}px solid ${expanded ? "var(--accent)" : "color-mix(in srgb, var(--border) 48%, var(--text-muted))"}`, borderRadius: 6, background: "var(--bg-panel)", boxShadow: expanded ? "0 0 0 3px color-mix(in srgb, var(--accent) 11%, transparent)" : "0 1px 2px color-mix(in srgb, var(--text) 7%, transparent)", transition: "grid-column .18s ease, min-height .18s ease, border-color .18s ease, box-shadow .18s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button type="button" onClick={handleTitleClick} title={expanded ? "Collapse session" : "Expand session"} style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 650, textAlign: "left" }}>
          <span style={{ width: 16, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", flexShrink: 0 }}><SessionStateIcon running={running} unread={unread} /></span>
          <span title={workspaceName(session)} style={{ maxWidth: "36%", overflow: "hidden", paddingRight: 8, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workspaceName(session)}</span>
          <span aria-hidden="true" style={{ width: 1, height: 14, background: "var(--border)", flexShrink: 0 }} />
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", paddingLeft: 8, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionTitle(session)}</span>
        </button>
        <button type="button" onClick={onPin} title={pinned ? "Unpin from board" : "Pin to board"} aria-label={pinned ? "Unpin from board" : "Pin to board"} style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 4, background: pinned ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "transparent", color: pinned ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
        </button>
      </div>
      <div style={{ height: expanded ? 38 : 55, margin: "10px 0 8px", padding: "7px 8px", overflow: "hidden", borderLeft: "2px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.45 }}>{session.firstMessage || "No prompt recorded"}</div>
      <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{relativeTime(session.modified)} ago · {session.messageCount} msgs</div>
      {expanded && <div style={{ height: mobile ? "min(76dvh, 700px)" : "min(70dvh, 720px)", minHeight: 420, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)", overflow: "hidden" }}><ChatWindow session={session} newSessionCwd={null} /></div>}
    </article>
  );
}

function SessionStateIcon({ running, unread }: { running: boolean; unread: boolean }) {
  if (running) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" aria-label="Running" style={{ flexShrink: 0 }}>
        <g><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" /><path d="M20 12a8 8 0 1 1-2.34-5.66" /></g>
      </svg>
    );
  }
  if (unread) return <span aria-label="Unread output" title="Unread output" style={{ width: 8, height: 8, background: "var(--accent)", flexShrink: 0 }} />;
  return null;
}

