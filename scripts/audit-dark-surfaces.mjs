#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/audit-dark-surfaces.mjs <css-file> [...css-file]");
  process.exitCode = 1;
} else {
  const rawWhiteSurface = /\bbackground(?:-color)?\s*:\s*(?:#fff(?:fff)?\b|white\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi;
  const findings = [];

  for (const file of files) {
    const absolutePath = resolve(file);
    const css = await readFile(absolutePath, "utf8");
    const lines = css.split("\n");

    lines.forEach((line, index) => {
      if (rawWhiteSurface.test(line)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`);
      }
      rawWhiteSurface.lastIndex = 0;
    });
  }

  if (findings.length > 0) {
    console.error("Unexpected raw white backgrounds in a dark Hashpix surface:");
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Dark-surface audit passed for ${files.length} CSS file(s).`);
  }
}
