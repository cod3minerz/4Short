import assert from "node:assert/strict";
import test from "node:test";
import { requestHash } from "../../services/control-api/src/services/idempotency.js";

test("request hash is stable across object key order and sensitive to values", () => {
  assert.equal(
    requestHash({ source: { url: "x", kind: "youtube" }, count: 4 }),
    requestHash({ count: 4, source: { kind: "youtube", url: "x" } }),
  );
  assert.notEqual(requestHash({ count: 4 }), requestHash({ count: 5 }));
});
