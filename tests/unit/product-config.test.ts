import assert from "node:assert/strict";
import test from "node:test";
import { minutePackages, productPlans } from "../../packages/product-config/src/index.js";

test("paid plans keep 1080p and all packages cost more per minute than subscriptions", () => {
  for (const code of ["start", "creator", "studio"] as const) {
    assert.equal(productPlans[code].exportHeight, 1920);
    assert.equal(productPlans[code].watermark, false);
  }

  const creatorPerMinute = productPlans.creator.priceKopecks / (productPlans.creator.includedSeconds / 60);
  for (const pack of minutePackages) {
    assert.ok(pack.priceKopecks / (pack.seconds / 60) > creatorPerMinute);
  }
});

test("queue weight, project concurrency and storage grow monotonically", () => {
  const ordered = [productPlans.free, productPlans.start, productPlans.creator, productPlans.studio];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(ordered[index].queueWeight >= ordered[index - 1].queueWeight);
    assert.ok(ordered[index].activeProjects >= ordered[index - 1].activeProjects);
    assert.ok(ordered[index].storageBytes > ordered[index - 1].storageBytes);
  }
});
