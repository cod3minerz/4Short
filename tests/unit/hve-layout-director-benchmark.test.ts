import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { signCorpusIndex } from "../../scripts/hve/corpus-index.mjs";

const hash = "a".repeat(64);
const report = {
  schemaVersion: 1,
  kind: "hve-layout-director-benchmark-v1",
  status: "pass",
  corpus: { version: "hve-g6-eval-v1", signedObjectIndexSha256: hash, evaluatorKeyFingerprint: hash, annotationSetSha256: hash },
  candidate: {
    regionDetector: "detector", regionModelVersion: "v1", regionModelSha256: hash,
    faceDetector: "detector", faceModelVersion: "v1", faceModelSha256: hash,
    directorVersion: "hve-director-v1", directorCodeSha256: hash,
  },
  hardware: { profile: "timeweb-cpu8-12gb", cpuCount: 8, memoryBytes: 12 * 1024 ** 3 },
  strata: {
    screen_presenter: { items: 24, samples: 120, screenRegionRecall: 0.96, faceRegionRecall: 0.91, layoutAccuracy: 0.93 },
    gameplay_facecam: { items: 24, samples: 120, screenRegionRecall: 0.96, faceRegionRecall: 0.91, layoutAccuracy: 0.93 },
    panel_three_four: { items: 24, samples: 120, panelTrackRecall: 0.91, layoutAccuracy: 0.91 },
  },
  safety: { forbiddenLayoutRate: 0, importantScreenCropLossRate: 0.01, p95LayoutTransitionLatencyMs: 500 },
  resources: { p95DenseAnalysisRssBytes: 8 * 1024 ** 3, sustainedSwapBytes: 0 },
  evaluation: {
    evaluatorVersion: "hve-layout-director-evaluator-v1",
    itemsEvaluated: 60,
    rangesEvaluated: 60,
    predictionBundleSha256: hash,
    labelBundleSha256: hash,
    requiredRegionRecall: 1,
    failureSamples: [],
  },
};

async function writeReport(value: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hve-g6-benchmark-"));
  const output = path.join(directory, "report.json");
  const publicKeyPath = path.join(directory, "public.pem");
  const keypair = generateKeyPairSync("ed25519");
  const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await Promise.all([
    writeFile(output, JSON.stringify(signCorpusIndex(value, privateKey))),
    writeFile(publicKeyPath, keypair.publicKey.export({ type: "spki", format: "pem" }).toString()),
  ]);
  return { output, publicKeyPath };
}

function validate({ output, publicKeyPath }: { output: string; publicKeyPath: string }) {
  return spawnSync(process.execPath, ["scripts/hve/validate-layout-director-benchmark.mjs", `--report=${output}`, `--public-key=${publicKeyPath}`], {
    cwd: process.cwd(), encoding: "utf8",
  });
}

test("HVE-G6 promotion validator accepts complete independently bound evidence", async () => {
  const result = validate(await writeReport(report));
  assert.equal(result.status, 0, result.stderr);
});

test("HVE-G6 promotion validator rejects a non-zero forbidden layout rate", async () => {
  const result = validate(await writeReport({ ...report, safety: { ...report.safety, forbiddenLayoutRate: 0.001 } }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbiddenLayoutRate must equal zero/);
});

test("HVE-G6 promotion validator rejects a report modified after evaluator signing", async () => {
  const evidence = await writeReport(report);
  const tampered = JSON.parse(await readFile(evidence.output, "utf8"));
  tampered.candidate.directorVersion = "tampered-director";
  await writeFile(evidence.output, JSON.stringify(tampered));
  const result = validate(evidence);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid Ed25519 signature/i);
});
