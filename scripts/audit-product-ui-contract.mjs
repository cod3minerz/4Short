#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "app/globals.css");
const uiDirectory = resolve(root, "components/hashpix");
const requiredTokens = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover",
  "--popover-foreground", "--primary", "--primary-foreground", "--secondary",
  "--secondary-foreground", "--muted", "--muted-foreground", "--accent",
  "--accent-foreground", "--destructive", "--border", "--input", "--ring",
];

const failures = [];
const css = await readFile(cssPath, "utf8");
const rootBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

for (const token of requiredTokens) {
  if (!rootBlock.includes(`${token}:`)) failures.push(`Missing canonical token in the internal preset scope: ${token}`);
}

// b38miVLH6 uses the neutral/indigo Mira palette. These checks prevent a
// second Hashpix token bridge from silently overriding the actual preset.
for (const [token, value] of [
  ["--primary", "oklch(0.398 0.195 277.366)"],
  ["--primary-foreground", "oklch(0.962 0.018 272.314)"],
]) {
  const declaration = new RegExp(`${token}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  if (!declaration.test(rootBlock)) failures.push(`Canonical token ${token} must be ${value}`);
}

if (!/--radius:\s*0\.625rem/.test(css)) {
  failures.push("Canonical token --radius must be 0.625rem in the preset root scope");
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

const productRoots = ["app/dashboard", "app/admin", "app/sign-in", "components/hashpix"];
for (const productRoot of productRoots) {
  const filesInRoot = await readdir(resolve(root, productRoot), { recursive: true });
  for (const file of filesInRoot.filter((entry) => /\.(css|tsx?|mjs)$/.test(entry))) {
    const source = await readFile(resolve(root, productRoot, file), "utf8");
    const legacy = source.match(/--(?:hp|dash|ink|white)-[\w-]+/);
    if (legacy) failures.push(`Legacy visual token remains in ${productRoot}/${file}: ${legacy[0]}`);
  }
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
  console.log(`Product UI contract passed: ${requiredTokens.length} preset roles, ${files.length} shared compositions.`);
}
