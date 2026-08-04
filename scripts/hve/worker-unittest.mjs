import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

/**
 * Run a deterministic worker test in the same image that carries FFmpeg,
 * libass, OpenCV and pinned Python wheels to production. Local Python remains
 * a convenience fallback, but it is never confused with image evidence.
 *
 * Set HVE_WORKER_TEST_IMAGE=fourshort-media-worker:<immutable-tag> in CI or
 * after a local production-image build. The tests directory is mounted
 * read-only; no customer media, S3 credential or evaluator key enters it.
 */
function runWorkerPython(name, { args, mounts = [] }) {
  const started = performance.now();
  const image = process.env.HVE_WORKER_TEST_IMAGE?.trim();
  const python = process.env.HVE_PYTHON ?? process.env.PYTHON ?? "python3";
  const result = image
    ? spawnSync("docker", [
        "run", "--rm",
        ...mounts.flatMap(({ host, container, readOnly = false }) => [
          "--volume",
          `${path.resolve(process.cwd(), host)}:${container}${readOnly ? ":ro" : ""}`,
        ]),
        // Keep the image's child reaper in this proof.  A worker runs under
        // tini in production; replacing it with Python would turn a correctly
        // terminated descendant into an unreaped zombie in a one-off test
        // container and falsely report a process leak.
        "--entrypoint", "/usr/bin/tini",
        "-e", "PYTHONPATH=/app/services/media-worker/src",
        image,
        "--", "python", ...args,
      ], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    : spawnSync(python, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONPATH: path.join(process.cwd(), "services", "media-worker", "src") },
      });
  const executable = image ? "docker" : python;
  const command = image
    ? `docker run ${image} python ${args.map(shellQuote).join(" ")}`
    : [python, ...args].map(shellQuote).join(" ");
  return {
    name,
    command,
    status: result.status === 0 && !result.error ? "PASS" : "FAIL",
    wallSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
    runtime: image ? `docker:${image}` : `local:${executable}`,
  };
}

export function runWorkerUnittest(name, { file, pattern }) {
  const files = Array.isArray(file) ? file : [file];
  const results = files.map((testFile) => {
    const testArgs = [
      "-m", "unittest", "discover",
      "-s", process.env.HVE_WORKER_TEST_IMAGE?.trim() ? "/tests" : "services/media-worker/tests",
      "-p", testFile,
    ];
    if (pattern) testArgs.push("-k", pattern);
    return runWorkerPython(name, {
      args: testArgs,
      mounts: [{ host: "services/media-worker/tests", container: "/tests", readOnly: true }],
    });
  });
  return {
    ...results[0],
    status: results.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
    wallSeconds: Number(results.reduce((total, result) => total + result.wallSeconds, 0).toFixed(3)),
    command: results.map((result) => result.command).join(" && "),
    output: results.map((result) => result.output).join("\n"),
  };
}

export function runWorkerModule(name, { args, mounts = [] }) {
  return runWorkerPython(name, { args, mounts });
}

export function workerTestRuntimeDescription() {
  const image = process.env.HVE_WORKER_TEST_IMAGE?.trim();
  return image ? `docker:${image}` : `local:${process.env.HVE_PYTHON ?? process.env.PYTHON ?? "python3"}`;
}
