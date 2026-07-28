import assert from "node:assert/strict";
import test from "node:test";
import { createTBankOrderId, createTBankToken } from "../../services/control-api/src/services/tbank.js";

test("T-Bank token matches the official SHA-256 example and ignores nested objects", () => {
  const token = createTBankToken({
    TerminalKey: "MerchantTerminalKey",
    Amount: 19200,
    OrderId: "00000",
    Description: "Подарочная карта на 1000 рублей",
    DATA: { private: "not-signed" },
    Receipt: { Items: [] },
  }, "11111111111111");

  assert.equal(token, "72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2");
});

test("T-Bank order id is deterministic, bounded and does not expose the idempotency key", () => {
  const id = createTBankOrderId("workspace:private-purchase-key");
  assert.equal(id, createTBankOrderId("workspace:private-purchase-key"));
  assert.ok(id.length <= 50);
  assert.equal(id.includes("private"), false);
});
