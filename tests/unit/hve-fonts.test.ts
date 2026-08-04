import assert from "node:assert/strict";
import test from "node:test";
import {
  HveFontNotExecutableError,
  resolveHveFontPlan,
} from "../../packages/contracts/src/index.js";

test("HVE resolves the bundled subtitle font to an immutable renderer pack", () => {
  assert.deepEqual(resolveHveFontPlan({ fontFamily: "HVE Sans" }), {
    id: "hve-sans-v1",
    requestedFamily: "HVE Sans",
    rendererFamily: "DejaVu Sans",
    packVersion: "hve-font-pack-dejavu-2.37-1",
  });
});

test("HVE refuses unverified custom and host-only subtitle fonts", () => {
  assert.throws(
    () => resolveHveFontPlan({ fontFamily: "Inter" }),
    (error: unknown) => error instanceof HveFontNotExecutableError && error.code === "HVE_FONT_NOT_INSTALLED",
  );
  assert.throws(
    () => resolveHveFontPlan({
      fontFamily: "HVE Sans",
      fontAssetId: "10000000-0000-4000-8000-000000000001",
    }),
    (error: unknown) => error instanceof HveFontNotExecutableError && error.code === "HVE_CUSTOM_FONT_UNSUPPORTED",
  );
});
