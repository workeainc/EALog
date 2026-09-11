import type { ActiveSession, ProjectId, WorkLog } from "../types/tracker";

/**
 * The only authoritative project identity for a running timer.  UI selection,
 * routes, Todo links and cached page state are intentionally not inputs here.
 */
export function projectIdFromActiveSession(
  session: Pick<ActiveSession, "projectId">,
): ProjectId {
  if (typeof session.projectId !== "string" || !session.projectId.trim())
    throw new Error("Active session has no valid project.");
  return session.projectId;
}

/** Fail closed rather than writing a work log under the wrong project. */
export function assertWorkLogMatchesActiveSession(
  session: Pick<ActiveSession, "projectId">,
  log: Pick<WorkLog, "projectId">,
): void {
  const projectId = projectIdFromActiveSession(session);
  if (log.projectId !== projectId)
    throw new Error("Project mismatch: active session and work log project differ.");
}
