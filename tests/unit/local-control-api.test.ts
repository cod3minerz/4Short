import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local control API loads its declared environment and registers source previews", async () => {
  const [packageJson, app] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../services/control-api/src/app.ts", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageJson) as { scripts?: Record<string, string> };

  assert.equal(manifest.scripts?.["dev:api"], "tsx watch --env-file=.env services/control-api/src/server.ts");
  assert.match(app, /import \{ mediaRoutes \} from "\.\/routes\/media\.js"/);
  assert.match(app, /await app\.register\(mediaRoutes\)/);
});
