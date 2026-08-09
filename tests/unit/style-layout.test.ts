import assert from "node:assert/strict";
import test from "node:test";
import { layoutLabelFromConfig } from "../../app/dashboard/lib/style-layout.js";

test("style layout labels never erase an asset-backed video/image configuration", () => {
  const layout = {
    mode: "video_image" as const,
    assetId: "11111111-1111-4111-8111-111111111111",
    videoPosition: "top" as const,
  };
  assert.equal(layoutLabelFromConfig(layout), "Видео + изображение");
  assert.deepEqual(layout, {
    mode: "video_image",
    assetId: "11111111-1111-4111-8111-111111111111",
    videoPosition: "top",
  });
});
