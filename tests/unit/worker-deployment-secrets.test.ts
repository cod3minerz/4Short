import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../..", import.meta.url);

test("worker Compose uses a persistent API-token env file, never a workflow temp path", async () => {
  const compose = await readFile(new URL("compose.worker.yml", root), "utf8");
  assert.match(compose, /- \/etc\/4short\/worker-api-token\.env/);
  assert.doesNotMatch(compose, /- \/tmp\/4short-worker-api-token\.env/);
});

test("privileged worker deploy atomically installs and validates the staged API token", async () => {
  const deployer = await readFile(new URL("infra/worker/bin/4short-worker-deploy", root), "utf8");
  assert.match(deployer, /staged_worker_token_env="\/tmp\/4short-worker-api-token\.env"/);
  assert.match(deployer, /worker_token_env="\/etc\/4short\/worker-api-token\.env"/);
  assert.match(deployer, /must contain exactly one token line/);
  assert.match(deployer, /install -m 0640 -o root -g deploy/);
  assert.match(deployer, /mv -f "\$\{worker_token_env\}\.next" "\$\{worker_token_env\}"/);
  assert.match(deployer, /len\(os\.environ\.get\('WORKER_API_TOKEN', ''\)\) >= 32/);
});

test("worker benchmark can only run on the drained, idle immutable release", async () => {
  const deployer = await readFile(new URL("infra/worker/bin/4short-worker-deploy", root), "utf8");
  assert.match(deployer, /run_hardware_benchmark\(\)/);
  assert.match(deployer, /enable worker drain first/);
  assert.match(deployer, /worker still reports an active job/);
  assert.match(deployer, /verify_runtime >\/dev\/null/);
  assert.match(deployer, /--duration-seconds=60 --threads=4/);
  assert.match(deployer, /Refusing to overwrite benchmark evidence/);
  assert.match(deployer, /\[\[ "\$\{release_sha\}" == "benchmark" \]\]/);
});
