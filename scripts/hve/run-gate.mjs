import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const registryPath = new URL("../../verification/hve/gate-registry.json", import.meta.url);
const argumentsAfterScript = process.argv.slice(2);
const inlineEvidenceArgument = argumentsAfterScript.find((argument) => argument.startsWith("--evidence="));
const separatedEvidenceIndex = argumentsAfterScript.indexOf("--evidence");
const releaseThresholdArgument = argumentsAfterScript.find((argument) => argument.startsWith("--release-thresholds="));
const releasePublicKeyArgument = argumentsAfterScript.find((argument) => argument.startsWith("--release-public-key="));
const evidenceValue = inlineEvidenceArgument?.slice("--evidence=".length)
  ?? (separatedEvidenceIndex >= 0 ? argumentsAfterScript[separatedEvidenceIndex + 1] : undefined);
const requestedIds = argumentsAfterScript.filter((argument, index) => (
  !argument.startsWith("--evidence=")
  && !argument.startsWith("--release-thresholds=")
  && !argument.startsWith("--release-public-key=")
  && argument !== "--evidence"
  && (separatedEvidenceIndex < 0 || index !== separatedEvidenceIndex + 1)
));
const releaseThresholds = releaseThresholdArgument?.slice("--release-thresholds=".length)
  ?? "verification/hve/thresholds/production-v1.json";
const releasePublicKey = releasePublicKeyArgument?.slice("--release-public-key=".length);

let registry;
try {
  registry = JSON.parse(await readFile(registryPath, "utf8"));
} catch (error) {
  console.error(`ERROR: cannot read gate registry: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(3);
}

if (!requestedIds.length) {
  console.error("ERROR: specify one or more gate IDs, for example: npm run hve:gate -- HVE-G1");
  process.exit(3);
}

const gates = new Map(registry.gates.map((gate) => [gate.id, gate]));
let status = "PASS";

async function evidenceState(gate) {
  if (!evidenceValue) return { ok: false, message: "no evidence directory supplied" };
  const evidenceDirectory = path.resolve(evidenceValue);
  const missing = [];
  for (const artifact of gate.requiredArtifacts) {
    try {
      await access(path.join(evidenceDirectory, artifact));
    } catch {
      missing.push(artifact);
    }
  }
  if (missing.length) return { ok: false, message: `missing required artifacts: ${missing.join(", ")}` };
  try {
    const metrics = JSON.parse(await readFile(path.join(evidenceDirectory, "metrics.json"), "utf8"));
    const suiteNames = new Set(Array.isArray(metrics.suites) ? metrics.suites.map((suite) => suite?.name ?? suite?.command) : []);
    const nonPassing = Array.isArray(metrics.suites) ? metrics.suites.filter((suite) => suite?.status !== "PASS") : [];
    if (nonPassing.length) return { ok: false, message: "one or more evidence suites are not PASS" };
    const unmatched = gate.requiredSuites.filter((suite) => ![...suiteNames].some((name) => String(name).includes(suite)));
    // Artifact presence is not coverage.  A gate may only be activated once
    // its evidence explicitly names every required suite.  Smoke reports are
    // still useful while a gate is scaffolded, but cannot become accidental
    // release evidence simply because all of their own commands succeeded.
    if (unmatched.length) {
      return { ok: false, message: `evidence does not cover required suites: ${unmatched.join(", ")}` };
    }
    return { ok: true, message: "all declared suites present" };
  } catch (error) {
    return { ok: false, message: `cannot read metrics.json: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function releaseEvidenceState() {
  if (!evidenceValue) return { status: "INSUFFICIENT", message: "no release evidence directory supplied" };
  const command = [
    "scripts/hve/validate-production-release.mjs",
    `--evidence-dir=${path.resolve(evidenceValue)}`,
    `--thresholds=${path.resolve(releaseThresholds)}`,
  ];
  if (releasePublicKey) command.push(`--public-key=${path.resolve(releasePublicKey)}`);
  const result = spawnSync(process.execPath, command, { cwd: process.cwd(), encoding: "utf8" });
  const message = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status === 0) return { status: "PASS", message };
  if (result.status === 1) return { status: "FAIL", message };
  if (result.status === 2) return { status: "INSUFFICIENT", message };
  return { status: "ERROR", message: message || result.error?.message || "release verifier could not execute" };
}

for (const id of [...new Set(requestedIds)]) {
  const gate = gates.get(id);
  if (!gate) {
    console.error(`ERROR ${id}: unknown gate`);
    status = "ERROR";
    continue;
  }
  const evidence = await evidenceState(gate);
  if (gate.status !== "active") {
    console.error(`INSUFFICIENT ${id}: gate is ${gate.status}; ${evidence.message}. A scaffold gate cannot approve a production capability.`);
    if (status !== "ERROR") status = "INSUFFICIENT";
    continue;
  }
  if (id === "HVE-G9") {
    const release = releaseEvidenceState();
    if (release.status === "PASS") {
      console.error(`PASS ${id}: ${release.message}`);
      continue;
    }
    console.error(`${release.status} ${id}: ${release.message}`);
    if (release.status === "ERROR") status = "ERROR";
    else if (release.status === "FAIL" && status !== "ERROR") status = "FAIL";
    else if (release.status === "INSUFFICIENT" && status === "PASS") status = "INSUFFICIENT";
    continue;
  }
  if (!evidence.ok) {
    console.error(`INSUFFICIENT ${id}: active gate evidence is incomplete; ${evidence.message}.`);
    if (status !== "ERROR") status = "INSUFFICIENT";
    continue;
  }
  console.error(`INSUFFICIENT ${id}: active gate execution is not implemented yet; fail closed rather than skipping evidence.`);
  if (status !== "ERROR") status = "INSUFFICIENT";
}

process.exit(registry.exitCodes[status] ?? 3);
