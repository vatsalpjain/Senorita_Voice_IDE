"use client";

/**
 * activityStore — lightweight localStorage-backed event log
 * Broadcasts changes via a custom "senorita-activity" window event
 * so the dashboard page can update live (same tab).
 */

export type ActivityEventType =
  | "accept"     // user accepted an AI code suggestion
  | "reject"     // user rejected an AI code suggestion
  | "commit"     // user manually committed / saved
  | "summarize"; // user opened session summary

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: number;          // Date.now()
  filename: string;           // which file was changed
  project: string;            // folder/project name
  description: string;        // short human-readable label
  action?: string;            // insert | replace_file | …
  linesChanged?: number;
}

const STORAGE_KEY = "senorita_activity_log";
const MAX_EVENTS  = 500;

function loadEvents(): ActivityEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActivityEvent[]) : [];
  } catch {
    return [];
  }
}

function saveEvents(events: ActivityEvent[]): void {
  if (typeof window === "undefined") return;
  const trimmed = events.slice(-MAX_EVENTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function broadcast(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("senorita-activity"));
}

export function pushActivity(event: Omit<ActivityEvent, "id">): void {
  const events = loadEvents();
  const full: ActivityEvent = { ...event, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  events.push(full);
  saveEvents(events);
  broadcast();
}

export function getActivities(): ActivityEvent[] {
  return loadEvents();
}

export function clearActivities(): void {
  saveEvents([]);
  broadcast();
}

/** Returns a map of dateKey → count, where dateKey = "YYYY-MM-DD" */
export function getContributionMap(): Record<string, number> {
  const events = loadEvents();
  const map: Record<string, number> = {};
  for (const e of events) {
    if (e.type === "reject") continue; // don't count rejects as contributions
    const d = new Date(e.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map[key] = (map[key] ?? 0) + 1;
  }
  return map;
}
