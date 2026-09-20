export type FolderPage = { truncated: boolean; oldestSentAt: string | null }

/** Gmail's before: operator accepts Unix seconds. Include the oldest second
 * again on the next page because several messages can share that second. */
export function gmailBeforeCursor(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) throw new Error('Invalid Gmail backfill timestamp')
  return String(Math.floor(time / 1000) + 1)
}

/** Each Graph folder has its own cursor. A single minimum date across Inbox
 * and SentItems can skip a still-unread interval in one of the folders. */
export function microsoftBackfillState(inbox: FolderPage, sent: FolderPage, inboxDone: boolean, sentDone: boolean) {
  if ((inbox.truncated && !inbox.oldestSentAt) || (sent.truncated && !sent.oldestSentAt)) {
    throw new Error('Microsoft backfill cursor missing for a truncated folder')
  }
  const cursorPatch = {
    ms_backfill_inbox_before: inbox.truncated ? inbox.oldestSentAt : null,
    ms_backfill_inbox_done: inboxDone || !inbox.truncated,
    ms_backfill_sent_before: sent.truncated ? sent.oldestSentAt : null,
    ms_backfill_sent_done: sentDone || !sent.truncated,
  }
  return { truncated: !cursorPatch.ms_backfill_inbox_done || !cursorPatch.ms_backfill_sent_done, cursorPatch }
}
