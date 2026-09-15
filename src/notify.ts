// Parent notifications. Default transport is ntfy (a topic URL like
// https://ntfy.sh/<secret-topic>): plain POST, Title/Click/Tags headers, free phone app.
// Any webhook that accepts a POST body works the same way — the GHL sidecar can slot in later.
//
// EVERY GROWN-UP IN THE HOUSEHOLD, not one topic per family. This is what makes the rest of
// the multi-grown-up feature actually work: the promise is that the tablet stops travelling
// between two houses, and a co-parent whose phone never rings never opens the queue, so the
// tablet starts travelling again. A household topic that only the owner subscribed to would
// have left the second household with a feature they had to remember to go and look at.

import type { Family } from "./repo";
import { listMembers } from "./repo-members";
import { notifyUrlSafe } from "./ssrf-guard";

export interface Notification {
  title: string;
  body: string;
  clickUrl?: string; // deep link opened when the phone notification is tapped
  tags?: string;     // ntfy emoji shortcodes, e.g. "star,tada"
}

/** Fire-and-forget: notification failures must never break the kid-facing flow. */
function post(url: string, n: Notification): void {
  const headers: Record<string, string> = { Title: n.title };
  if (n.clickUrl) headers.Click = n.clickUrl;
  if (n.tags) headers.Tags = n.tags;
  // Re-check the target at egress, not only at write time: a row persisted by an older build
  // (or a future write path) must never turn into a server-side request to a LAN/loopback host.
  // `redirect: "manual"` stops a public URL from bouncing the POST onto an internal address.
  notifyUrlSafe(url)
    .then((ok) => { if (ok) return fetch(url, { method: "POST", headers, body: n.body, redirect: "manual" }); })
    .catch(() => {});
}

/**
 * Ring every grown-up who has asked to be rung.
 *
 * `families.notify_url` IS THE OWNER'S FALLBACK, and treating it as anything else breaks one
 * of the two households. It is the topic a single-parent install already has subscribed on a
 * real phone, so dropping it the moment anyone else joins would silently stop notifications
 * for every family that has been running since before members existed — and the symptom of
 * that is notifications quietly ceasing, which is exactly the failure the household topic was
 * introduced to end. So the owner falls back to it; a member with their own topic uses theirs.
 *
 * Nobody else falls back to it. Ringing the household topic on a supporter's behalf would buzz
 * the OWNER's phone about something the supporter asked for, which is noise attributed to the
 * wrong person.
 *
 * Deduped by URL: the owner's phone can legitimately hold both, and two buzzes for one chore
 * reads as a bug.
 */
export function notifyParent(family: Family, n: Notification): void {
  const targets = new Set<string>();
  for (const m of listMembers(family.id)) {
    const url = m.notify_url ?? (m.role === "owner" ? family.notify_url : null);
    if (url) targets.add(url);
  }
  // A household with no grown-ups at all cannot happen (createFamily mints the owner, and
  // src/db.ts backfills one onto every household that predates them) — but a notification is
  // the wrong place to find out, so the household topic still fires if it somehow does.
  if (targets.size === 0 && family.notify_url) targets.add(family.notify_url);
  for (const url of targets) post(url, n);
}
