#!/usr/bin/env node
// Enforces .claude/skills/anti-slop-landing/SKILL.md on app/landing/**. Exit code 1 on any violation.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../app/landing/", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|css)$/.test(name)) files.push(path);
  }
})(root);

const copyRules = [
  [/революционн|мощн(ый|ая|ое|ые|ого|ую)\b|бесшовн|инновацион|передов(ой|ая|ое)|уникальн|раскро(йте|ем) потенциал|в мире, где|новый уровень|магия|играюч|всё в одном|next-?level|seamless|unlock|supercharge/i, "marketing cliché"],
  [/не просто[^.]{0,60},\s*а\b/i, "«не просто X, а Y»"],
  [/\b(тысяч|млн|миллион)\w*\s+(авторов|пользователей|клиентов|команд)/i, "invented user count"],
  [/доверя(ют|ет)|нам доверяют|trusted by|отзыв(ы|ов) клиентов|★|⭐/i, "invented social proof"],
  [/[✦✨🚀🔥💡🎬]/u, "decorative AI glyph or emoji"],
  [/!(?=["'<\s}`)]|$)/, "exclamation mark in copy"],
];
const cssRules = [
  [/(linear|radial|conic)-gradient/i, "gradient"],
  [/text-shadow:[^;]*(0 0 [4-9]|0 0 [1-9]\d)/i, "glow text-shadow"],
  [/box-shadow:[^;]*rgba\(\s*(255|139|99|168)[^)]*\)[^;]*\d{2,}px/i, "coloured glow"],
  [/(?<!backdrop-)filter:\s*blur\(/i, "blur blob"],
  [/border-radius:\s*(?!var\(--lp-r-)[^;]*\b(1[1-9]|[2-9]\d|\d{3})px/i, "radius outside the Gravity scale"],
  [/font-weight:\s*(?!400\b|600\b)\d+/i, "font weight other than 400/600"],
];
const backdropAllowed = /landing\.css$/; // header only, checked below

let failures = 0;
const fail = (file, line, rule, text) => {
  failures += 1;
  console.error(`${relative(process.cwd(), file)}:${line}  ${rule}  ${text.trim().slice(0, 100)}`);
};

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const isCss = file.endsWith(".css");
  lines.forEach((text, index) => {
    if (/audit-allow/.test(text)) return;
    if (isCss) {
      const code = text.replace(/\/\*.*?\*\//g, "");
      for (const [re, rule] of cssRules) if (re.test(code)) fail(file, index + 1, rule, text);
      if (/backdrop-filter/.test(code) && !(backdropAllowed.test(file) && /is-scrolled/.test(code))) fail(file, index + 1, "backdrop-filter outside the sticky header", text);
    } else {
      // Only check visible strings: lines that are not imports or pure code identifiers.
      if (/^\s*(import|export \{|\/\/)/.test(text)) return;
      for (const [re, rule] of copyRules) if (re.test(text)) fail(file, index + 1, rule, text);
    }
  });
}

// Section artefact rule: every top-level section component must render a product artefact marker.
const sections = readFileSync(join(root, "sections.tsx"), "utf8");
for (const name of ["How", "Moments", "Subtitles", "Device", "Pricing"]) {
  const body = sections.split(new RegExp(`export function ${name}\\b`))[1]?.split(/\nexport function /)[0] ?? "";
  if (!/(lp-art|MomentsExplorer|lp-presets|lp-flow|lp-price|CutScene)/.test(body)) fail(join(root, "sections.tsx"), 1, "section without a product artefact", name);
}

if (failures) {
  console.error(`\n${failures} anti-slop violation(s).`);
  process.exit(1);
}
console.log(`anti-slop audit passed (${files.length} files).`);
