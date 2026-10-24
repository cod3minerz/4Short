import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cuttingModes } from "../../app/product/clipping-config";

test("source configuration only offers a worker-backed local cutting mode", async () => {
  assert.deepEqual(cuttingModes, [{ id: "uniform", label: "Равномерная нарезка" }]);

  const source = await readFile(new URL("../../app/product/source-configuration.tsx", import.meta.url), "utf8");
  assert.match(source, /useState<CuttingMode>\("uniform"\)/);
  assert.match(source, /setMode\("uniform"\)/);
  assert.match(source, /momentSettings: \{ mode,/);
  assert.match(source, /LockedField label="Поиск моментов по смыслу"/);
});
