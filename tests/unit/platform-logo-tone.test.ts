import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("product shells use the supplied Narezai lockup and orange icon", async () => {
  const [dashboard, admin, lockup, mark] = await Promise.all([
    readFile(new URL("../../app/dashboard/components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/components/admin-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/logo-narezai.svg", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/logo-narezai-mark.svg", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /<Logo priority tone="light" markOnly=\{narrow\} \/>/);
  assert.equal((admin.match(/<Logo priority tone="light" \/>/g) ?? []).length, 2);
  assert.match(lockup, /fill="white"/);
  assert.match(lockup, /fill="#FF9326"/);
  assert.match(mark, /fill="#FF9326"/);
});
