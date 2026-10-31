/**
 * Desktop release manifest. CI uploads the installers and `latest.json` to the public downloads bucket;
 * `DESKTOP_RELEASE_MANIFEST_URL` points at that file. Until it exists the landing shows «скоро» instead of links.
 */
export type ReleaseFile = { url: string; bytes: number; sha256?: string };
export type Release = { version: string; date: string; mac?: ReleaseFile; windows?: ReleaseFile };

function isFile(value: unknown): value is ReleaseFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return typeof file.url === "string" && /^https:\/\//.test(file.url) && typeof file.bytes === "number" && file.bytes > 0;
}

export async function getRelease(): Promise<Release | null> {
  const manifest = process.env.DESKTOP_RELEASE_MANIFEST_URL;
  if (!manifest) return null;
  try {
    const response = await fetch(manifest, { next: { revalidate: 300 } });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.version !== "string" || typeof data.date !== "string") return null;
    const release: Release = {
      version: data.version,
      date: data.date,
      mac: isFile(data.mac) ? data.mac : undefined,
      windows: isFile(data.windows) ? data.windows : undefined,
    };
    return release.mac || release.windows ? release : null;
  } catch {
    return null;
  }
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} МБ`;
