#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  approvedTypesetRoots,
  arbitraryClassAllowlist,
  dashboardGeometrySha256,
  primitiveGeometryExceptions,
  productRoots,
  publicRoots,
  rawControlAllowlist,
} from "./product-ui-allowlist.mjs";

const root = resolve(import.meta.dirname, "..");
const failures = [];

const requiredTheme = {
  root: {
    "--background": "oklch(1 0 0)",
    "--foreground": "oklch(0.145 0 0)",
    "--card": "oklch(1 0 0)",
    "--card-foreground": "oklch(0.145 0 0)",
    "--popover": "oklch(1 0 0)",
    "--popover-foreground": "oklch(0.145 0 0)",
    "--primary": "oklch(0.457 0.24 277.023)",
    "--primary-foreground": "oklch(0.962 0.018 272.314)",
    "--secondary": "oklch(0.967 0.001 286.375)",
    "--secondary-foreground": "oklch(0.21 0.006 285.885)",
    "--muted": "oklch(0.97 0 0)",
    "--muted-foreground": "oklch(0.556 0 0)",
    "--accent": "oklch(0.97 0 0)",
    "--accent-foreground": "oklch(0.205 0 0)",
    "--destructive": "oklch(0.577 0.245 27.325)",
    "--border": "oklch(0.922 0 0)",
    "--input": "oklch(0.922 0 0)",
    "--ring": "oklch(0.708 0 0)",
    "--radius": "0.625rem",
  },
  dark: {
    "--background": "oklch(0.145 0 0)",
    "--foreground": "oklch(0.985 0 0)",
    "--card": "oklch(0.205 0 0)",
    "--card-foreground": "oklch(0.985 0 0)",
    "--popover": "oklch(0.205 0 0)",
    "--popover-foreground": "oklch(0.985 0 0)",
    "--primary": "oklch(0.398 0.195 277.366)",
    "--primary-foreground": "oklch(0.962 0.018 272.314)",
    "--secondary": "oklch(0.274 0.006 286.033)",
    "--secondary-foreground": "oklch(0.985 0 0)",
    "--muted": "oklch(0.269 0 0)",
    "--muted-foreground": "oklch(0.708 0 0)",
    "--accent": "oklch(0.269 0 0)",
    "--accent-foreground": "oklch(0.985 0 0)",
    "--destructive": "oklch(0.704 0.191 22.216)",
    "--border": "oklch(1 0 0 / 10%)",
    "--input": "oklch(1 0 0 / 15%)",
    "--ring": "oklch(0.556 0 0)",
  },
};

const registryFiles = new Set([
  "alert-dialog.tsx", "badge.tsx", "button.tsx", "card.tsx", "checkbox.tsx",
  "dialog.tsx", "dropdown-menu.tsx", "field.tsx", "input-otp.tsx", "input.tsx",
  "label.tsx", "popover.tsx", "progress.tsx", "scroll-area.tsx", "select.tsx",
  "separator.tsx", "sheet.tsx", "sidebar.tsx", "skeleton.tsx", "slider.tsx",
  "switch.tsx", "table.tsx", "tabs.tsx", "textarea.tsx", "toggle-group.tsx",
  "toggle.tsx", "tooltip.tsx",
]);

async function filesUnder(path) {
  const full = resolve(root, path);
  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(full, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(relative(root, entryPath)));
    else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) files.push(relative(root, entryPath));
  }
  return files;
}

async function sourceFiles(roots) {
  const files = [];
  for (const path of roots) {
    if (/\.[jt]sx?$/.test(path)) files.push(path);
    else files.push(...await filesUnder(path));
  }
  return files;
}

function cssBlock(source, selector) {
  return source.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ?? "";
}

function classTokens(source) {
  return [...source.matchAll(/className="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const globals = await readFile(resolve(root, "app/globals.css"), "utf8");
const componentsJson = JSON.parse(await readFile(resolve(root, "components.json"), "utf8"));
const layout = await readFile(resolve(root, "app/layout.tsx"), "utf8");
const productFiles = await sourceFiles(productRoots);
const publicFiles = await sourceFiles(publicRoots);
const productSources = await Promise.all(productFiles.map(async (file) => [file, await readFile(resolve(root, file), "utf8")]));

if (componentsJson.style !== "base-vega") failures.push("components.json must use base-vega.");
if (componentsJson.iconLibrary !== "hugeicons") failures.push("components.json must use Hugeicons.");
if (componentsJson.tailwind?.baseColor !== "neutral" || componentsJson.tailwind?.cssVariables !== true) failures.push("components.json must retain neutral CSS-variable foundation.");
if (!/Onest\(/.test(layout) || !/Geist_Mono\(/.test(layout) || !/latin/.test(layout) || !/cyrillic/.test(layout) || !/--font-onest/.test(layout) || !/--font-geist-mono/.test(layout)) failures.push("Root layout must load Onest and Geist Mono with Cyrillic coverage.");
if (/landing\.css/.test(layout)) failures.push("Root layout must not import public landing CSS.");

for (const [scope, expected] of Object.entries(requiredTheme)) {
  const block = cssBlock(globals, scope === "root" ? ":root" : ".dark");
  for (const [token, value] of Object.entries(expected)) {
    if (!block.includes(`${token}: ${value};`)) failures.push(`Canonical ${scope} token ${token} must be ${value}.`);
  }
}
if (globals.includes(".hp-overlay-scope")) failures.push("Legacy portal scope remains in global CSS.");
if (!globals.includes('@import "./typeset.css"')) failures.push("Canonical Typeset stylesheet must remain imported by globals.css.");

const uiFiles = (await readdir(resolve(root, "components/ui"))).filter((file) => file.endsWith(".tsx"));
for (const file of uiFiles) {
  if (!registryFiles.has(file)) failures.push(`Unreviewed source in registry-owned components/ui: ${file}.`);
  const source = await readFile(resolve(root, "components/ui", file), "utf8");
  if (/@heroui|lucide-react|components\/hashpix|app\/dashboard/.test(source)) failures.push(`Registry primitive contains a project/legacy dependency: components/ui/${file}.`);
}
for (const file of registryFiles) if (!uiFiles.includes(file)) failures.push(`Missing canonical registry primitive: components/ui/${file}.`);

const forbiddenImport = /(?:from\s+["'](?:@heroui\/|lucide-react|@\/components\/hashpix\/(?:action-button|field|info-panel)|@\/docs\/archive|@\/components\/legacy)|import\s+["'](?:@heroui\/|lucide-react))/;
for (const [file, source] of productSources) {
  const legacyToken = source.match(/--(?:hp|dash|ink|white)-[\w-]+|hp-overlay-scope/);
  if (legacyToken) failures.push(`Legacy token/scope in ${file}: ${legacyToken[0]}`);
  if (forbiddenImport.test(source)) failures.push(`Forbidden product UI import in ${file}.`);
  if (/['"]\/dashboard\/styles(?:['"/])/.test(source)) failures.push(`Removed /dashboard/styles route referenced by ${file}.`);
  if (/<(?:dialog\b|[^>]+role=["']dialog["'])/.test(stripComments(source))) failures.push(`Manual dialog implementation in ${file}; use registry Dialog or AlertDialog.`);
}

for (const [file, source] of productSources) {
  const typesetUses = [...source.matchAll(/className="([^"]*\btypeset\b[^"]*)"/g)].map((match) => match[1]);
  if (!typesetUses.length) continue;
  const expected = approvedTypesetRoots.get(file);
  if (!expected || typesetUses.some((value) => value !== expected)) failures.push(`Unapproved Typeset root in ${file}.`);
}
for (const file of approvedTypesetRoots.keys()) {
  if (!productFiles.includes(file)) failures.push(`Approved Typeset root is missing: ${file}.`);
}

const typographySource = await readFile(resolve(root, "components/hashpix/typography.tsx"), "utf8");
if (!/function PageTitle/.test(typographySource) || !/function SectionTitle/.test(typographySource)) failures.push("Canonical PageTitle/SectionTitle source is missing.");
for (const [file, source] of productSources) {
  if (file === "components/hashpix/typography.tsx" || approvedTypesetRoots.has(file)) continue;
  if (/<h[1-6]\b/.test(stripComments(source))) failures.push(`Raw product heading in ${file}; use semantic typography.`);
}
if (productFiles.includes("app/dashboard/components/page-heading.tsx")) failures.push("Legacy dashboard PageHeading duplicate remains; use shared PageHeader.");

const publicHeroImports = [];
for (const file of publicFiles) {
  const source = await readFile(resolve(root, file), "utf8");
  if (/@heroui|lucide-react/.test(source)) publicHeroImports.push(file);
}
if (!publicHeroImports.length) failures.push("Public HeroUI/Lucide boundary unexpectedly has no explicit consumer.");
const publicBoundary = await readFile(resolve(root, "app/public-boundary.css"), "utf8");
if (!publicBoundary.includes('@import "@heroui/styles"') || !publicBoundary.includes('@import "./landing.css"')) failures.push("Public HeroUI styles must remain isolated in app/public-boundary.css.");

for (const [file, rawSource] of productSources) {
  const source = stripComments(rawSource);
  for (const match of source.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const tag = match[1];
    const attributes = match[2];
    if (tag !== "input") {
      failures.push(`Raw <${tag}> in product source ${file}; use a canonical primitive.`);
      continue;
    }
    const allow = rawControlAllowlist.get(file);
    const type = attributes.match(/type=["']([^"']+)/)?.[1];
    if (!allow || allow.type !== type) failures.push(`Raw input in ${file} is not an approved ${allow?.type ?? ""} specialised control.`);
  }

  for (const token of classTokens(rawSource)) {
    if (!token.includes("[") || token.startsWith("data-[")) continue;
    if (!arbitraryClassAllowlist.has(token)) failures.push(`Unclassified arbitrary class ${token} in ${file}.`);
  }

  for (const match of rawSource.matchAll(/<(Button|AsyncButton|Input|Textarea|SelectTrigger|Card|Tabs|TabsList|TabsTrigger|Badge)\b[^>]*className="([^"]+)"/g)) {
    const [, primitive, classes] = match;
    if (!/(?:^|\s)(?:h-|min-h-|max-h-|px-|py-|rounded-|text-|font-|shadow-)/.test(classes)) continue;
    const key = `${file}:${primitive}:${classes}`;
    if (!primitiveGeometryExceptions.has(key)) failures.push(`Unclassified ${primitive} geometry override in ${file}: ${classes}`);
  }
}

const geometryPath = resolve(root, "app/dashboard/dashboard-geometry.css");
const geometry = await readFile(geometryPath, "utf8");
const geometryHash = createHash("sha256").update(geometry).digest("hex");
if (geometryHash !== dashboardGeometrySha256) failures.push("dashboard-geometry.css changed: review and update the explicit structural allowlist before merging.");
if (/:focus(?:-visible)?\b/.test(geometry)) failures.push("dashboard-geometry.css must not own focus paint.");
if (/--(?:hp|dash)-[\w-]+|hp-overlay-scope/.test(geometry)) failures.push("dashboard-geometry.css contains legacy tokens or overlay scope.");
if (!geometry.startsWith("/*\n * Hashpix dashboard structural and media geometry.")) failures.push("dashboard geometry stylesheet lost its scoped-boundary header.");
const dashboardLayout = await readFile(resolve(root, "app/dashboard/layout.tsx"), "utf8");
if (!dashboardLayout.includes('import "./dashboard-geometry.css"')) failures.push("Dashboard layout must be the only owner of the specialised geometry stylesheet.");

const sharedDirectory = await readdir(resolve(root, "components/hashpix"));
for (const file of sharedDirectory.filter((entry) => entry.endsWith(".tsx"))) {
  const source = await readFile(resolve(root, "components/hashpix", file), "utf8");
  const literal = source.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  if (literal) failures.push(`Literal visual value in shared composition ${file}: ${literal[0]}`);
}

if (failures.length) {
  console.error("Product UI architecture gate failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Product UI architecture gate passed: Vega theme, ${registryFiles.size} registry primitives, ${productFiles.length} product files, ${publicHeroImports.length} public-boundary icon/UI consumers.`);
}
