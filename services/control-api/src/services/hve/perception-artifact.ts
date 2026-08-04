import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../../../../db/index.js";
import { analysisArtifacts, engineReleases, mediaObjects, sourceAnalyses } from "../../../../../db/schema.js";
import {
  hashHve,
  hveSceneGraphSchema,
  sourceAnalysisManifestSchema,
  type HvePerceptionLayoutContext,
} from "../../../../../packages/contracts/src/index.js";
import { readVerifiedJsonArtifact } from "../../lib/s3.js";

type SourceProbe = {
  video?: { width?: unknown; height?: unknown; rotation?: unknown };
};

function sourceGeometry(probe: unknown) {
  const video = probe && typeof probe === "object" && !Array.isArray(probe)
    ? (probe as SourceProbe).video
    : undefined;
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);
  const rotation = Number(video?.rotation ?? 0);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  // OpenCV source analysis currently runs in encoded-frame coordinates. Do not
  // apply that artifact to display-rotated media until the worker records a
  // normalized orientation transform as part of the artifact contract.
  if (![0, 360].includes(rotation)) return null;
  return { width, height };
}

/**
 * Loads one exact scene-graph artifact for HVE-5 planning. The database binds
 * source analysis to an active engine release; the object hash is verified
 * again before parsing. Returning null means "no evidence" (a normal state),
 * while corrupted/mismatched evidence throws and must not be rendered.
 */
export async function loadVerifiedHvePerceptionContext(input: {
  db: Database;
  workspaceId: string;
  sourceId: string;
  sourceHash: string;
  analysisId: string;
  probe: unknown;
}): Promise<HvePerceptionLayoutContext | null> {
  const geometry = sourceGeometry(input.probe);
  if (!geometry) return null;
  const [row] = await input.db.select({
    analysis: sourceAnalyses,
    artifact: analysisArtifacts,
    artifactMedia: mediaObjects,
    release: engineReleases,
  }).from(sourceAnalyses)
    .innerJoin(analysisArtifacts, eq(analysisArtifacts.analysisId, sourceAnalyses.id))
    .innerJoin(mediaObjects, eq(mediaObjects.id, analysisArtifacts.mediaObjectId))
    .innerJoin(engineReleases, eq(engineReleases.id, sourceAnalyses.engineReleaseId))
    .where(and(
      eq(sourceAnalyses.id, input.analysisId),
      eq(sourceAnalyses.workspaceId, input.workspaceId),
      eq(sourceAnalyses.sourceId, input.sourceId),
      eq(sourceAnalyses.sourceHash, input.sourceHash),
      eq(sourceAnalyses.status, "succeeded"),
      eq(analysisArtifacts.kind, "scene_graph"),
      eq(engineReleases.status, "active"),
    ))
    .orderBy(desc(analysisArtifacts.createdAt))
    .limit(1);
  if (!row) return null;
  const manifest = sourceAnalysisManifestSchema.parse(row.analysis.manifest);
  if (
    manifest.analysisId !== row.analysis.id
    || manifest.sourceId !== input.sourceId
    || manifest.sourceHash !== input.sourceHash
    || await hashHve(manifest) !== row.analysis.manifestHash
  ) {
    throw new Error("HVE5_ANALYSIS_MANIFEST_MISMATCH");
  }
  const faceEvidence = manifest.artifacts.faces?.find((slice) => (
    slice.artifact.artifactId === row.artifact.id
    && slice.artifact.objectKey === row.artifact.objectKey
    && slice.artifact.sha256 === row.artifact.sha256
    && slice.artifact.schemaVersion === row.artifact.schemaVersion
    && slice.artifact.engineVersion === row.artifact.engineVersion
  ));
  if (!faceEvidence) {
    throw new Error("HVE5_FACE_EVIDENCE_MANIFEST_MISMATCH");
  }
  if (row.artifact.engineVersion !== row.release.engineVersion) {
    throw new Error("HVE5_ARTIFACT_ENGINE_RELEASE_MISMATCH");
  }
  const value = await readVerifiedJsonArtifact({
    bucket: row.artifactMedia.bucket,
    key: row.artifact.objectKey,
    sha256: row.artifact.sha256,
  });
  const graph = hveSceneGraphSchema.parse(value);
  if (
    graph.sourceId !== input.sourceId
    || graph.sourceHash !== input.sourceHash
    || graph.engineVersion !== row.release.engineVersion
  ) {
    throw new Error("HVE5_ARTIFACT_SOURCE_OR_RELEASE_MISMATCH");
  }
  return {
    analysisId: row.analysis.id,
    graph,
    source: { sourceId: input.sourceId, sourceHash: input.sourceHash, ...geometry },
    faceEvidence: {
      density: faceEvidence.density,
      coverage: faceEvidence.coverage.map((range) => ({ startUs: range.startUs, endUs: range.endUs })),
    },
  };
}
