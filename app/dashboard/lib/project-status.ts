const terminalStatuses = new Set<string>([
  "ready",
  "partially_ready",
  "failed",
  "review_required",
  "archived",
]);

/** A queued sidecar must never override a project's authoritative terminal state. */
export function isProjectJobQueued(projectStatus: string, jobStatus?: string) {
  if (terminalStatuses.has(projectStatus)) return false;
  return jobStatus === "queued" || jobStatus === "waiting_provider";
}
