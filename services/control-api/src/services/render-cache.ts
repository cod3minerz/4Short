/**
 * Admission policy for a reusable render artifact.
 *
 * A render hash is a lookup key, not proof that an object can safely be served
 * to another clip. Keep this policy pure so the database query cannot quietly
 * weaken it when the cache evolves.
 */
export type RenderCacheCandidate = {
  requestedWorkspaceId: string;
  mediaWorkspaceId: string;
  mediaDeletedAt: Date | null;
  mediaExpiresAt: Date | null;
  validation: unknown;
};

function hasPassedValidation(validation: unknown): boolean {
  return Boolean(
    validation
      && typeof validation === "object"
      && !Array.isArray(validation)
      && (validation as Record<string, unknown>).valid === true,
  );
}

/**
 * Returns true only for an already validated, retained object owned by the
 * requested workspace. Expiry is strict: an object at `now` is unavailable.
 */
export function isAdmissibleRenderCacheCandidate(
  candidate: RenderCacheCandidate,
  now = new Date(),
): boolean {
  if (candidate.requestedWorkspaceId !== candidate.mediaWorkspaceId) return false;
  if (candidate.mediaDeletedAt !== null) return false;
  if (candidate.mediaExpiresAt !== null && candidate.mediaExpiresAt.getTime() <= now.getTime()) return false;
  return hasPassedValidation(candidate.validation);
}
