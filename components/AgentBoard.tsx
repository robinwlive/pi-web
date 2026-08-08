"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { ChatWindow } from "./ChatWindow";
import { FileExplorer } from "./FileExplorer";
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

function sessionTitle(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage.trim() || "Untitled session";
}

function isRecent(session: SessionInfo, now: number): boolean {
  return now - new Date(session.modified).getTime() < RECENT_ACTIVITY_MS;
}

function draftSessionInfo(cwd: string): SessionInfo {
  const nowIso = new Date().toISOString();
  return { path: cwd, id: `new:${cwd}`, cwd, name: "New session", created: nowIso, modified: nowIso, messageCount: 0, firstMessage: "" };
}

// --- 内联 SVG 图标（与 pi-web 现有风格一致，stroke-based） ---
const iconProps = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function FolderIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
}
function PlusIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>;
}
function SkipBackIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" /></svg>;
}
function SkipForwardIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>;
}
function FolderOpenIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" /></svg>;
}
function MaximizeIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>;
}
function MinimizeIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>;
}
function XIcon({ size = 13 }: { size?: number }) {
  return <svg {...iconProps} width={size} height={size} aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
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
  const [newDraftCwd, setNewDraftCwd] = useState<string | null>(null);
  const [fileManagerCwd, setFileManagerCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigationHistoryRef = useRef<SessionInfo[]>([]);

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

  // 全局跳转目标：执行中优先，其次未读，按最近修改倒序（不受当前卡片选择影响）。
  const orderedActive = useMemo(() => {
    return sessions
      .filter((session) => runningIds.has(session.id) || (unreadIds.has(session.id) && !runningIds.has(session.id)))
      .sort((a, b) => {
        const rankA = runningIds.has(a.id) ? 0 : 1;
        const rankB = runningIds.has(b.id) ? 0 : 1;
        if (rankA !== rankB) return rankA - rankB;
        return b.modified.localeCompare(a.modified);
      });
  }, [runningIds, sessions, unreadIds]);

  const currentSession = useMemo(() => {
    if (newDraftCwd) return sessions.find((s) => s.cwd === newDraftCwd) ?? null;
    return sessions.find((s) => s.id === expandedId) ?? null;
  }, [expandedId, newDraftCwd, sessions]);

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

  const openSession = useCallback((session: SessionInfo) => {
    setExpandedId(session.id);
    setNewDraftCwd(null);
    markRead(session.id);
  }, [markRead]);

  const jumpToNextActive = useCallback(() => {
    const current = currentSession;
    if (orderedActive.length === 0) return;
    let index = -1;
    if (current) index = orderedActive.findIndex((s) => s.id === current.id);
    const next = orderedActive[(index + 1 + orderedActive.length) % orderedActive.length];
    if (current && next.id === current.id) return;
    if (current) navigationHistoryRef.current.push(current);
    openSession(next);
  }, [currentSession, openSession, orderedActive]);

  const jumpToPrevious = useCallback(() => {
    const previous = navigationHistoryRef.current.pop();
    if (!previous) return;
    openSession(previous);
  }, [openSession]);

  const startNewInWorkspace = useCallback((cwd: string) => {
    navigationHistoryRef.current = [];
    setNewDraftCwd(cwd);
    setExpandedId(null);
  }, []);

  const handleBoardBackgroundClick = useCallback(() => {
    setExpandedId(null);
    setNewDraftCwd(null);
  }, []);

  const canJumpPrevious = navigationHistoryRef.current.length > 0;

  const actionButton = (disabled: boolean, children: ReactNode, title: string): CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    height: isMobile ? 34 : 28, padding: "0 9px",
    border: "1px solid var(--border)", borderRadius: 4,
    background: "transparent", color: "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 11, opacity: disabled ? 0.4 : 1, flexShrink: 0,
    fontFamily: "inherit",
  });

  const renderCard = (session: SessionInfo, key: string, extra: { isDraft?: boolean; expandedOverride?: boolean }) => {
    const expanded = extra.expandedOverride ?? expandedId === session.id;
    const running = runningIds.has(session.id);
    const unread = unreadIds.has(session.id);
    const pinned = pinnedIds.has(session.id);
    return (
      <BoardCard
        key={key}
        session={session}
        mobile={isMobile}
        expanded={expanded}
        running={running}
        unread={unread}
        pinned={pinned}
        isDraft={Boolean(extra.isDraft)}
        canJumpPrevious={canJumpPrevious}
        onToggle={() => {
          if (expanded) {
            setExpandedId(null);
            setNewDraftCwd(null);
          } else {
            if (newDraftCwd) setNewDraftCwd(null);
            navigationHistoryRef.current = [];
            openSession(session);
          }
        }}
        onPin={() => togglePin(session.id)}
        onMarkRead={() => markRead(session.id)}
        onJumpNext={() => jumpToNextActive()}
        onJumpPrevious={() => jumpToPrevious()}
        onNewSession={() => startNewInWorkspace(session.cwd)}
        onOpenFiles={() => setFileManagerCwd(session.cwd)}
        onCollapse={() => { setExpandedId(null); setNewDraftCwd(null); }}
        onDraftCreated={() => {
          setNewDraftCwd(null);
          window.setTimeout(() => void refresh(), 600);
        }}
      />
    );
  };

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
        {loading && sessions.length === 0 && !newDraftCwd ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading sessions...</div> : (
          <div onClick={handleBoardBackgroundClick} style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(12, minmax(0, 1fr))", gridAutoFlow: "dense", gap: 10, alignItems: "start" }}>
            {newDraftCwd && renderCard(draftSessionInfo(newDraftCwd), `new:${newDraftCwd}`, { isDraft: true, expandedOverride: true })}
            {orderedSessions.length === 0 && !newDraftCwd ? <div style={{ padding: "56px 12px", color: "var(--text-muted)", textAlign: "center", fontSize: 13 }}>No sessions currently need attention.</div> : orderedSessions.map((session) => renderCard(session, session.id, {}))}
          </div>
        )}
      </main>

      {fileManagerCwd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 0 : 18, background: "rgba(12,18,28,.42)" }}>
          <div style={{ width: "min(900px,100%)", height: "min(78dvh,720px)", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border)", borderRadius: isMobile ? 0 : 9, background: "var(--bg-panel)", boxShadow: "0 20px 60px rgba(20,35,65,.24)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{ fontSize: 13 }}>Files</strong>
                <code style={{ overflow: "hidden", color: "var(--text-muted)", fontSize: 10, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileManagerCwd}</code>
              </div>
              <button type="button" onClick={() => setFileManagerCwd(null)} title="Close file manager" aria-label="Close file manager" style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}><XIcon size={15} /></button>
            </div>
            <div style={{ minHeight: 0, flex: 1, overflow: "auto", background: "var(--bg)" }}>
              <FileExplorer cwd={fileManagerCwd} onOpenFile={(filePath) => window.alert(`Open ${filePath} from the Pi Web session view`)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BoardCard({ session, mobile, expanded, running, unread, pinned, isDraft, canJumpPrevious, onToggle, onPin, onMarkRead, onJumpNext, onJumpPrevious, onNewSession, onOpenFiles, onCollapse, onDraftCreated }: {
  session: SessionInfo;
  mobile: boolean;
  expanded: boolean;
  running: boolean;
  unread: boolean;
  pinned: boolean;
  isDraft: boolean;
  canJumpPrevious: boolean;
  onToggle: () => void;
  onPin: () => void;
  onMarkRead: () => void;
  onJumpNext: () => void;
  onJumpPrevious: () => void;
  onNewSession: () => void;
  onOpenFiles: () => void;
  onCollapse: () => void;
  onDraftCreated: () => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (expanded && !mobile && !isFullscreen) {
      cardRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [expanded, isFullscreen, mobile]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    const el = cardRef.current;
    if (el) void el.requestFullscreen().catch(() => {});
  };

  const handleTitleClick = () => {
    if (!expanded && unread) onMarkRead();
    onToggle();
  };

  const actionStyle = (disabled = false): CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    height: mobile ? 34 : 28, padding: "0 9px",
    border: "1px solid var(--border)", borderRadius: 4,
    background: "transparent", color: "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 11, opacity: disabled ? 0.4 : 1, flexShrink: 0,
    fontFamily: "inherit",
  });

  return (
    <article
      ref={cardRef}
      onClick={(event) => event.stopPropagation()}
      style={{
        gridColumn: mobile ? "span 1" : expanded ? "span 8" : "span 3",
        position: mobile && expanded ? "fixed" : undefined,
        top: mobile && expanded ? 0 : undefined,
        left: mobile && expanded ? 0 : undefined,
        right: mobile && expanded ? 0 : undefined,
        bottom: mobile && expanded ? 0 : undefined,
        zIndex: mobile && expanded ? 200 : undefined,
        minWidth: 0,
        minHeight: expanded ? (mobile ? 0 : 510) : 206,
        maxHeight: mobile && expanded ? "100dvh" : undefined,
        display: "flex",
        flexDirection: "column",
        padding: expanded ? 12 : 13,
        border: `${expanded ? 2 : 1}px solid ${expanded ? "var(--accent)" : "color-mix(in srgb, var(--border) 48%, var(--text-muted))"}`,
        borderRadius: mobile && expanded ? 0 : 6,
        background: "var(--bg-panel)",
        boxShadow: expanded ? "0 0 0 3px color-mix(in srgb, var(--accent) 11%, transparent)" : "0 1px 2px color-mix(in srgb, var(--text) 7%, transparent)",
        transition: "grid-column .18s ease, min-height .18s ease, border-color .18s ease, box-shadow .18s ease",
        overflow: mobile && expanded ? "hidden" : "hidden",
      }}
    >
      {/* 标题行：状态 + 会话标题 + pin */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button type="button" onClick={handleTitleClick} title={expanded ? "Collapse session" : "Expand session"} style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", padding: 0, border: 0, background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12, fontWeight: 650, textAlign: "left" }}>
          <span style={{ width: 16, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", flexShrink: 0 }}><SessionStateIcon running={running} unread={unread} /></span>
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isDraft ? "New session" : sessionTitle(session)}</span>
        </button>
        {!isDraft && (
          <button type="button" onClick={onPin} title={pinned ? "Unpin from board" : "Pin to board"} aria-label={pinned ? "Unpin from board" : "Pin to board"} style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 4, background: pinned ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "transparent", color: pinned ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>
          </button>
        )}
      </div>

      {/* 工作区行（独立、醒目，展示完整路径） */}
      <div title={session.cwd} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, margin: "8px 0 7px", padding: "4px 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", flexShrink: 0, color: "var(--text-dim)" }}><FolderIcon size={11} /></span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.cwd}</span>
      </div>

      {/* 摘要 */}
      <div style={{ height: expanded ? 38 : 55, margin: "0 0 8px", padding: "7px 8px", overflow: "hidden", borderLeft: "2px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.45 }}>{isDraft ? "Type a message to start this session." : (session.firstMessage || "No prompt recorded")}</div>

      {/* 时间行 */}
      <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>{relativeTime(session.modified)} ago · {session.messageCount} msgs</div>

      {/* 操作栏（展开时） */}
      {expanded && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", flexWrap: mobile ? "wrap" : "nowrap" }}>
          {!isDraft && (
            <button type="button" onClick={onNewSession} title="New session in this workspace" style={actionStyle()}><PlusIcon /><span>New</span></button>
          )}
          <button type="button" onClick={onJumpPrevious} disabled={!canJumpPrevious} title="Back to previous jump" style={actionStyle(!canJumpPrevious)}><SkipBackIcon /><span>Prev</span></button>
          <button type="button" onClick={onJumpNext} title="Next running/unread session" style={actionStyle()}><SkipForwardIcon /><span>Next</span></button>
          {!isDraft && (
            <button type="button" onClick={onOpenFiles} title="Manage workspace files" style={actionStyle()}><FolderOpenIcon /><span>Files</span></button>
          )}
          <span style={{ flex: 1 }} />
          {mobile ? (
            <button type="button" onClick={onCollapse} title="Exit fullscreen session" style={actionStyle()}><MinimizeIcon /><span>Exit</span></button>
          ) : (
            <>
              <button type="button" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} style={actionStyle()}>{isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}<span>{isFullscreen ? "Exit" : "Full"}</span></button>
              <button type="button" onClick={onCollapse} title="Collapse session" style={actionStyle()}><XIcon /><span>Close</span></button>
            </>
          )}
        </div>
      )}

      {/* 聊天区（展开时） */}
      {expanded && (
        <div style={{ flex: mobile ? 1 : undefined, height: mobile ? undefined : "min(70dvh,720px)", minHeight: mobile ? 0 : 420, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ChatWindow
            session={isDraft ? null : session}
            newSessionCwd={isDraft ? session.cwd : null}
            onSessionCreated={isDraft ? onDraftCreated : undefined}
            onAgentEnd={() => {
              // 已展开且卡片在视口内，视为已读（不强制接近底部）。
              if (!isDraft) onMarkRead();
            }}
          />
        </div>
      )}
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
