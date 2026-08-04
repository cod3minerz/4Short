import assert from "node:assert/strict";
import test from "node:test";
import { layoutLabelFromConfig, simpleLayoutFromLabel } from "../../app/dashboard/lib/style-layout.js";

test("style layout labels never erase an asset-backed video/image configuration", () => {
  const layout = {
    mode: "video_image" as const,
    assetId: "11111111-1111-4111-8111-111111111111",
    videoPosition: "top" as const,
  };
  assert.equal(layoutLabelFromConfig(layout), "Видео + изображение");
  assert.equal(simpleLayoutFromLabel("Видео + изображение"), undefined);
  assert.deepEqual(layout, {
    mode: "video_image",
    assetId: "11111111-1111-4111-8111-111111111111",
    videoPosition: "top",
  });
});

test("the compact picker produces only complete layout configurations", () => {
  assert.deepEqual(simpleLayoutFromLabel("Активный спикер"), { mode: "active_speaker", smoothing: 0.82 });
  assert.deepEqual(simpleLayoutFromLabel("Фон с размытием"), { mode: "blur_background", blur: 32 });
  assert.equal(simpleLayoutFromLabel("Картинка в картинке"), undefined);
});
