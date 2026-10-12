#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scoped = process.argv.includes("--foundation");
const failures = [];
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) paths.push(path);
  }
  return paths;
}
const read = (path) => readFile(resolve(root, path), "utf8");
const productFiles = [...await walk("app/product"), ...await walk("app/dashboard"), ...await walk("app/sign-in"), ...await walk("app/sign-up"), ...await walk("app/forgot-password")];
const foundation = new Set([...await walk("app/product"), "app/dashboard/page.tsx", "app/dashboard/layout.tsx", "app/dashboard/components/dashboard-shell.tsx"]);
const checked = scoped ? productFiles.filter((file) => foundation.has(file)) : productFiles;
const legacy = [];
for (const path of productFiles) {
  const source = await read(path);
  if (/from\s*["'][^"']*(?:components\/ui\/|@base-ui\/|@radix-ui\/)/.test(source)) legacy.push(path);
  if (!checked.includes(path)) continue;
  if (/from\s*["'][^"']*(?:components\/ui\/|@base-ui\/|@radix-ui\/|lucide-react)/.test(source)) failures.push(`${path}: non-HeroUI control/icon import`);
  if (/<(?:button|select|dialog)\b/.test(source)) failures.push(`${path}: raw interactive control`);
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    if (!/type="(?:file|color)"/.test(match[0])) failures.push(`${path}: raw generic input`);
  }
  if (/['"]\/dashboard\/styles(?:['"/])/.test(source)) failures.push(`${path}: removed styles route`);
}
const theme = await read("app/product/product.css");
for (const [token, value] of Object.entries({"--background":"#1a1a1a", "--surface":"#18181b", "--field-background":"#313131", "--default":"#27272a", "--accent":"#fafafa", "--accent-foreground":"#181818"})) {
  if (!theme.includes(`${token}: ${value};`)) failures.push(`Opus theme mismatch: ${token}`);
}
if (!/\.hashpix-product\s*\{/.test(theme)) failures.push("Product theme must be scoped");
const boundary = await read("app/product/theme-boundary.tsx");
if (!/UNSAFE_PortalProvider/.test(boundary) || !/getContainer/.test(boundary)) failures.push("Shared product portal boundary missing");
const layout = await read("app/layout.tsx");
if (!/Onest\(/.test(layout) || !/cyrillic/.test(layout) || /Bounded/.test(layout)) failures.push("Onest/Cyrillic font contract mismatch");
for (const path of ["AGENTS.md", "docs/ui/design-system.md", "docs/ui/verification-protocol.md", ".claude/skills/hashpix-product-ui/SKILL.md", ".claude/skills/hashpix-page-verification/SKILL.md"]) {
  const source = await read(path);
  if (!/HeroUI/.test(source)) failures.push(`${path}: missing active HeroUI contract`);
  if (/source of truth is.*(?:shadcn|Vega)|HeroUI is public-boundary only/.test(source)) failures.push(`${path}: conflicting active contract`);
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`${scoped ? "FOUNDATION SCOPED PASS (not final acceptance)" : "Product UI source audit PASS"}: ${checked.length} files checked`);
if (legacy.length) console.log(`Migration debt: ${legacy.length} remaining legacy consumers\n${legacy.map(path => relative(root, resolve(root, path))).join("\n")}`);
console.log("Browser, capability, media and visual evidence are separate gates; this audit cannot certify them.");
