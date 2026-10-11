import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public routes share the canonical next/font Onest delivery", async () => {
  const [layout, publicBoundary, landing] = await Promise.all([
    readFile(new URL("../../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/public-boundary.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/landing.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /Onest\(\{ subsets: \["latin", "cyrillic"\], variable: "--font-onest" \}\)/);
  assert.match(layout, /Geist_Mono\(\{ subsets: \["latin", "cyrillic"\], variable: "--font-geist-mono", preload: false \}\)/);
  assert.match(publicBoundary, /--ds-font-sans: var\(--font-onest\), Arial, sans-serif/);
  assert.doesNotMatch(publicBoundary, /@font-face|Geist Variable|\/fonts\/geist-/);
  assert.match(landing, /font-family: var\(--ds-font-sans\)/);
  assert.doesNotMatch(landing, /Geist Variable/);
});
