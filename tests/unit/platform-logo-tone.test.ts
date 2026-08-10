import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dark product shells use the supplied white Hashpix wordmark", async () => {
  const [dashboard, admin, whiteAsset] = await Promise.all([
    readFile(new URL("../../app/dashboard/components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/components/admin-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../public/assets/logo-source.svg", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /<Logo priority tone="light" \/>/);
  assert.equal((admin.match(/<Logo priority tone="light" \/>/g) ?? []).length, 2);
  assert.match(whiteAsset, /fill="white"/);
});
