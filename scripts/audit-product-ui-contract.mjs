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

// These values are not taste-level defaults. They prevent the public blue
// marketing accent from silently leaking back into the dark product after a
// portal, HeroUI update, or one-off component refactor.
for (const [token, value] of [
  ["--hp-brand", "#f5f5f2"],
  ["--hp-brand-hover", "#e6e6e2"],
  ["--hp-brand-foreground", "#0b0b0c"],
  ["--hp-radius-control", "14px"],
  ["--hp-radius-surface", "18px"],
]) {
  const declaration = new RegExp(`${token}:\\s*${value.replace(/[.#]/g, "\\$&")}`, "i");
  if (!declaration.test(rootBlock)) failures.push(`Canonical token ${token} must be ${value}`);
}

if (!css.includes(".hp-overlay-scope")) {
  failures.push("Missing portal token scope; dialogs and drawers would inherit the marketing accent");
}

// These names belonged to the old demo-only phone/preset artwork. A product
// source can show a real thumbnail or an explicit unavailable state, but it
// must never restore an invented branded video preview just to fill space.
for (const forbiddenSelector of [
  "wizard-phone-preview",
  "style-editor__preview",
  "style-library-card__sample",
  "style-preset-grid",
  "preset-sample",
]) {
  if (css.includes(forbiddenSelector)) {
    failures.push(`Deprecated fake preview selector is still present: ${forbiddenSelector}`);
  }
}

// Generic product affordances are monochrome in the dark system. A future
// blue application action is almost always an accidental leak from the old
// marketing palette; user media and creator-defined subtitle colours are
// intentionally outside this stylesheet check.
for (const forbiddenValue of ["#3458ff", "#3152ff", "#2f5bff", "#335dff", "#2563eb", "#3b82f6"]) {
  if (css.toLowerCase().includes(forbiddenValue)) {
    failures.push(`Legacy blue product colour is still present: ${forbiddenValue}`);
  }
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
