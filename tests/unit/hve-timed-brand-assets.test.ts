import assert from "node:assert/strict";
import test from "node:test";
import { createBrandAssetUploadSchema, jobTypeSchema } from "../../packages/contracts/src/index.js";

const timedVideo = {
  name: "Короткое интро",
  kind: "video",
  fileName: "intro.mp4",
  mimeType: "video/mp4",
  byteSize: 8 * 1024 * 1024,
};

test("timed brand media is staged as bounded MP4 only", () => {
  assert.equal(createBrandAssetUploadSchema.safeParse(timedVideo).success, true);
  assert.equal(createBrandAssetUploadSchema.safeParse({
    ...timedVideo,
    kind: "broll",
    mimeType: "video/webm",
  }).success, false);
  assert.equal(createBrandAssetUploadSchema.safeParse({
    ...timedVideo,
    byteSize: 100 * 1024 * 1024 + 1,
  }).success, false);
});

test("timed brand verification is an explicit worker job, never an implicit render input", () => {
  assert.equal(jobTypeSchema.safeParse("verify_brand_video").success, true);
  assert.equal(jobTypeSchema.safeParse("brand_video_magic").success, false);
});
