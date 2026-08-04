import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Evidence for the HVE editor's deterministic data boundary.
 *
 * This is intentionally a narrow smoke: it proves the browser adapter emits
 * typed commands, recovery identity checks and the reducer rejects an invalid
 * edit before any render is queued. It does not claim two-tab browser
 * behaviour or preview/final parity; those remain HVE-G4 release
 * requirements.
 */
const argument = process.argv.find((value) => value.startsWith("--output-dir="));
const outputDirectory = path.resolve(argument?.slice("--output-dir=".length)
  ?? path.join("outputs", "hve", "hve-g4-smoke", new Date().toISOString().replaceAll(":", "-")));
await mkdir(outputDirectory, { recursive: true });

function run(name, executable, args) {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    name,
    command: [executable, ...args].join(" "),
    status: result.status === 0 && !result.error ? "PASS" : "FAIL",
    wallSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

const nodeBinary = process.execPath;
const suites = [
  run("draft_command_reducer", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-editor-commands.test.ts"]),
  run("focus_editor_command_adapter", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-draft-sync.test.ts"]),
  run("offline_command_identity", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-offline-command-queue.test.ts", "tests/unit/hve-draft-recovery.test.ts"]),
  run("immutable_render_plan", nodeBinary, ["./node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/hve-render-plan.test.ts"]),
];
const status = suites.some((suite) => suite.status === "FAIL") ? "FAIL" : "PASS";
const failedItems = suites.filter((suite) => suite.status !== "PASS")
  .map((suite) => ({ suite: suite.name, status: suite.status, output: suite.output.slice(-8_000) }));
const environment = {
  os: `${os.type()} ${os.release()}`,
  arch: process.arch,
  node: process.version,
  generatedAt: new Date().toISOString(),
  scope: "HVE-G4 typed-draft and offline-identity smoke only; not browser parity, two-tab conflict UX, or release approval.",
};
const metrics = {
  schemaVersion: 1,
  status,
  runId: `hve-g4-smoke-${Date.now()}`,
  createdAt: new Date().toISOString(),
  candidate: {
    editor: "app/dashboard/lib/hve-draft-sync.buildHveDraftSync",
    reducer: "@4short/contracts applyEditorDraftCommands",
    commit: "control-api editor draft commit boundary",
  },
  environment,
  suites: suites.map(({ name, command, status: suiteStatus, wallSeconds }) => ({ name, command, status: suiteStatus, wallSeconds })),
  requiredEvidenceStillMissing: [
    "browser execution of offline command queue and explicit conflict/rebase UX",
    "two-tab optimistic-concurrency browser test",
    "browser preview versus FFmpeg geometry/timing parity",
    "mobile editor interaction matrix",
  ],
};
const cdata = (value) => value.replaceAll("]]>", "]]]]><![CDATA[>");
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="hve-g4-smoke" tests="${suites.length}" failures="${failedItems.length}">${suites.map((suite) => `<testcase name="${suite.name}" time="${suite.wallSeconds}">${suite.status === "PASS" ? "" : `<failure message="${suite.status}"><![CDATA[${cdata(suite.output)}]]></failure>`}</testcase>`).join("")}</testsuite>\n`;
const report = `<!doctype html><html lang="en"><meta charset="utf-8"><title>HVE-G4 smoke</title><body><h1>HVE-G4 typed-draft smoke: ${status}</h1><p>Not a browser or production release approval.</p><pre>${JSON.stringify(metrics, null, 2).replaceAll("<", "&lt;")}</pre></body></html>\n`;
await Promise.all([
  writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "failed-items.json"), `${JSON.stringify(failedItems, null, 2)}\n`),
  writeFile(path.join(outputDirectory, "junit.xml"), junit),
  writeFile(path.join(outputDirectory, "report.html"), report),
]);
console.log(`HVE-G4 smoke ${status}: ${outputDirectory}`);
process.exit(status === "PASS" ? 0 : 1);
