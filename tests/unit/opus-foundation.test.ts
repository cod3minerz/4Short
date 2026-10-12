import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("Opus foundation scopes neutral tokens and one portal destination", async () => {
  const [css, boundary, shell] = await Promise.all([read("app/product/product.css"), read("app/product/theme-boundary.tsx"), read("app/dashboard/components/dashboard-shell.tsx")]);
  assert.match(css, /\.hashpix-product\s*\{/);
  for (const declaration of ["--background: #1a1a1a", "--accent: #fafafa", "--field-background: #313131"]) assert.ok(css.includes(declaration));
  assert.match(boundary, /UNSAFE_PortalProvider getContainer=\{getContainer\}/);
  assert.match(boundary, /locale="ru-RU"/);
  assert.match(shell, /@heroui\/react/);
  assert.doesNotMatch(shell, /components\/ui\/|dash-topbar|dash-frame|dash-mobile-nav/);
  assert.match(css, /grid-template-columns: 224px minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: 64px minmax\(0, 1fr\)/);
});
test("new Home does not reuse wizard or present preview fixtures as live projects", async () => {
  const home = await read("app/product/home.tsx");
  assert.doesNotMatch(home, /NewProjectWizard|Stepper|previewProjects/);
  assert.match(home, /const realProjects = connected \? projects : \[\]/);
  assert.match(home, /createSourcePreview/);
  assert.match(home, /preflight=\$\{encodeURIComponent\(preview.id\)\}/);
});
