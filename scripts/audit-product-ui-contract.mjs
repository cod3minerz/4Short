#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "app/dashboard/dashboard.css");
const uiDirectory = resolve(root, "app/dashboard/components/ui");
const requiredTokens = [
  "--hp-canvas", "--hp-surface", "--hp-surface-raised", "--hp-surface-subtle",
  "--hp-media", "--hp-line", "--hp-line-strong", "--hp-text", "--hp-text-muted",
  "--hp-brand", "--hp-brand-hover", "--hp-brand-pressed", "--hp-action-light",
  "--hp-action-light-hover", "--hp-action-light-pressed", "--hp-radius-action",
  "--hp-radius-field", "--hp-radius-overlay", "--hp-radius-panel", "--hp-control-sm",
  "--hp-control-md", "--hp-control-lg", "--hp-motion-interactive",
];

const failures = [];
const css = await readFile(cssPath, "utf8");
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

for (const token of requiredTokens) {
  if (!rootBlock.includes(`${token}:`)) failures.push(`Missing canonical token on :root: ${token}`);
}

for (const className of [".hp-action", ".hp-selectable-row"]) {
  if (!css.includes(className)) failures.push(`Missing shared primitive styling: ${className}`);
}

const files = (await readdir(uiDirectory)).filter((file) => file.endsWith(".tsx"));
for (const file of files) {
  const source = await readFile(resolve(uiDirectory, file), "utf8");
  const literal = source.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  if (literal) failures.push(`Literal visual value in shared primitive ${file}: ${literal[0]}`);
}

if (failures.length) {
  console.error("Product UI contract failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Product UI contract passed: ${requiredTokens.length} tokens, ${files.length} shared primitives.`);
}
