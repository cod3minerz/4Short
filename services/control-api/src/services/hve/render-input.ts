import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../../../../../db/index.js";
import { brandAssets, mediaObjects } from "../../../../../db/schema.js";
import {
  clipDocumentV2Schema,
  type ClipDocumentV2,
  type ResolvedRenderPlan,
} from "../../../../../packages/contracts/src/index.js";
import type { HveAssetResolver, HveProductionAsset } from "../../../../../packages/contracts/src/hve-layout.js";

/**
 * Private, immutable object locators passed from the control plane to a media
 * job. They are intentionally richer than the resolver contract used by the
 * planner: the resolver gets only a content identity, while the worker gets
 * the private S3 locator required to download and hash-verify the asset.
 */
export type RenderStaticAssetInput = {
  assetId: string;
  bucket: string;
  key: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
};

export type RenderTimedVideoAssetInput = {
  assetId: string;
  kind: "video" | "broll";
  bucket: string;
  key: string;
  sha256: string;
  mimeType: "video/mp4";
  byteSize: number;
  durationMs: number;
  profile: "hve-timed-visual-h264-aac-v1";
  // Timed asset audio is a future explicitly-versioned feature. Rendering it
  // before that contract exists would alter a creator's source audio silently.
  audioPolicy: "muted_until_timed_audio_is_implemented";
};

export type RenderAssetInput = RenderStaticAssetInput | RenderTimedVideoAssetInput;

const STATIC_BRAND_ASSET_MIME_TYPES = new Set<RenderStaticAssetInput["mimeType"]>([
  "image/png", "image/jpeg", "image/webp",
]);

function verifiedTimedVideoAsset(
  asset: typeof brandAssets.$inferSelect,
  media: typeof mediaObjects.$inferSelect,
): RenderTimedVideoAssetInput | null {
  const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, unknown>
    : null;
  const timedMedia = metadata?.timedMedia && typeof metadata.timedMedia === "object" && !Array.isArray(metadata.timedMedia)
    ? metadata.timedMedia as Record<string, unknown>
    : null;
  if (
    !["video", "broll"].includes(asset.kind)
    || metadata?.uploadStatus !== "completed"
    || media.mimeType !== "video/mp4"
    || !media.sha256
    || !timedMedia
    || timedMedia.profile !== "hve-timed-visual-h264-aac-v1"
    || timedMedia.audioPolicy !== "muted_until_timed_audio_is_implemented"
    || !Number.isSafeInteger(Number(timedMedia.durationMs))
    || Number(timedMedia.durationMs) < 40
    || Number(timedMedia.durationMs) > 120_000
    || media.byteSize <= 0
    || media.byteSize > 100 * 1024 * 1024
  ) return null;
  return {
    assetId: asset.id,
    kind: asset.kind === "broll" ? "broll" : "video",
    bucket: media.bucket,
    key: media.objectKey,
    sha256: media.sha256.toLowerCase(),
    mimeType: "video/mp4",
    byteSize: media.byteSize,
    durationMs: Number(timedMedia.durationMs),
    profile: "hve-timed-visual-h264-aac-v1",
    audioPolicy: "muted_until_timed_audio_is_implemented",
  };
}

export function assetIdsFromHveDocument(documentInput: ClipDocumentV2) {
  const document = clipDocumentV2Schema.parse(documentInput);
  return [...new Set(document.layers.flatMap((layer) => "assetId" in layer ? [layer.assetId] : []))];
}

/**
 * Resolves only assets owned by the workspace and still retained in private
 * storage. The returned map is a snapshot: later asset replacement/deletion
 * cannot mutate a queued version because the job verifies the returned hash.
 */
export async function loadVerifiedHveRenderAssets(input: {
  db: Database;
  workspaceId: string;
  document: ClipDocumentV2;
}): Promise<Map<string, RenderAssetInput>> {
  const assetIds = assetIdsFromHveDocument(input.document);
  if (!assetIds.length) return new Map();
  const rows = await input.db.select({ asset: brandAssets, media: mediaObjects })
    .from(brandAssets)
    .innerJoin(mediaObjects, eq(mediaObjects.id, brandAssets.mediaObjectId))
    .where(and(
      eq(brandAssets.workspaceId, input.workspaceId),
      eq(mediaObjects.workspaceId, input.workspaceId),
      inArray(brandAssets.id, assetIds),
      isNull(mediaObjects.deletedAt),
      or(isNull(mediaObjects.expiresAt), gt(mediaObjects.expiresAt, new Date())),
    ));
  if (rows.length !== assetIds.length) throw new Error("HVE_ASSET_NOT_AVAILABLE");

  return new Map(rows.map(({ asset, media }): [string, RenderAssetInput] => {
    const timed = verifiedTimedVideoAsset(asset, media);
    if (timed) return [asset.id, timed];
    if (!media.sha256 || !STATIC_BRAND_ASSET_MIME_TYPES.has(media.mimeType as RenderStaticAssetInput["mimeType"])) {
      throw new Error("HVE_BRAND_ASSET_INVALID");
    }
    return [asset.id, {
      assetId: asset.id,
      bucket: media.bucket,
      key: media.objectKey,
      sha256: media.sha256.toLowerCase(),
      mimeType: media.mimeType as RenderStaticAssetInput["mimeType"],
      byteSize: media.byteSize,
    }];
  }));
}

export function hveDocumentRequiresPerception(documentInput: ClipDocumentV2) {
  const document = clipDocumentV2Schema.parse(documentInput);
  return document.layout.some((segment) => segment.slots.some((slot) => Boolean(slot.cropTrack) && !slot.manualCrop));
}

/**
 * The planner hashes a portable resolved plan, so S3 locators must never be
 * copied into it. Keep private bucket/key data in the separate job snapshot
 * and give the pure planner only the exact public execution identity.
 */
export function hveAssetResolverForPlan(assets: Map<string, RenderAssetInput>): HveAssetResolver {
  return {
    get(assetId: string): HveProductionAsset | undefined {
      const asset = assets.get(assetId);
      if (!asset) return undefined;
      if ("kind" in asset) {
        return {
          assetId: asset.assetId,
          kind: asset.kind,
          sha256: asset.sha256,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          durationMs: asset.durationMs,
          profile: asset.profile,
          audioPolicy: asset.audioPolicy,
        };
      }
      return {
        assetId: asset.assetId,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
      };
    },
  };
}

/**
 * The worker validates `renderAssets` as a map-like list and rejects duplicate
 * ids deliberately. A creator may reuse one logo or banner in several layers,
 * so deduplicate by immutable asset id at the control-plane boundary rather
 * than weakening that worker validation.
 */
export function renderAssetsForResolvedPlan(
  resolvedPlan: ResolvedRenderPlan,
  assets: Map<string, RenderAssetInput>,
): RenderAssetInput[] {
  const result = new Map<string, RenderAssetInput>();
  for (const layer of resolvedPlan.layerPlan) {
    if (layer.type === "text") continue;
    const asset = assets.get(layer.asset.assetId);
    if (!asset) throw new Error("HVE_ASSET_NOT_AVAILABLE");
    result.set(asset.assetId, asset);
  }
  return [...result.values()];
}
