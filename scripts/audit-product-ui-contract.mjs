#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "app/globals.css");
const uiDirectory = resolve(root, "components/hashpix");
const requiredTokens = [
  "--hp-canvas", "--hp-surface", "--hp-surface-raised", "--hp-surface-subtle",
  "--hp-media", "--hp-line", "--hp-line-strong", "--hp-text", "--hp-text-muted",
  "--hp-brand", "--hp-brand-hover", "--hp-brand-pressed", "--hp-radius-control",
  "--hp-radius-surface", "--hp-radius-workspace", "--hp-motion-fast",
];

const failures = [];
const css = await readFile(cssPath, "utf8");
const rootBlock = css.match(/\.hp-theme,[\s\S]*?\{([\s\S]*?)\n\}/)?.[1] ?? "";

for (const token of requiredTokens) {
  if (!rootBlock.includes(`${token}:`)) failures.push(`Missing canonical token in the internal preset scope: ${token}`);
}

// b38miVLH6 uses the neutral/indigo Mira palette. These checks prevent the
// earlier neutral-white Hashpix palette from silently overriding the preset.
for (const [token, value] of [
  ["--hp-brand", "oklch(0.585 0.233 277.117)"],
  ["--hp-brand-hover", "oklch(0.511 0.262 276.966)"],
  ["--hp-brand-foreground", "oklch(0.985 0 0)"],
  ["--hp-radius-control", "var(--radius)"],
  ["--hp-radius-surface", "calc(var(--radius) + 4px)"],
]) {
  const declaration = new RegExp(`${token}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
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

for (const className of ["--primary", "--ring", "--radius"]) {
  if (!rootBlock.includes(className)) failures.push(`Missing shadcn preset role: ${className}`);
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
