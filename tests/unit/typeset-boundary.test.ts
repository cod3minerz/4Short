import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const typesetFixture = `
  <article class="typeset typeset-help">
    <h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>
    <p>Paragraph with <a href="#link">link</a> and <code>inline code</code>.</p>
    <ul><li>Parent<ul><li>Nested list</li></ul></li></ul>
    <pre><code>const longLine = "verification";</code></pre>
    <blockquote>Quote</blockquote><hr />
    <div class="typeset-scroll"><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table></div>
  </article>
`;

test("typeset keeps the full canonical rich-content contract and Help-only preset", async () => {
  const [typeset, globals, help, blog] = await Promise.all([
    readFile(new URL("../../app/typeset.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/dashboard/help/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/blog/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);

  for (const selector of [
    "&:where(h1, h2, h3, h4, h5, h6)",
    "&:where(ul.contains-task-list)",
    "&:where(details)",
    "&:where(kbd)",
    "&:where(dl)",
    "&:where(:not(pre) > code)",
    "&:where(pre)",
    "&:where(blockquote)",
    "&:where(hr)",
    "&:where(.footnotes, [data-footnotes])",
    "&:where(math[display=\"block\"])",
    "&:where(img, video)",
    "&:where(table)",
    "&:where(.typeset-scroll)",
    "@media print",
  ]) {
    assert.match(typeset, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(globals, /\.typeset-help\s*\{[\s\S]*?--typeset-font-body: var\(--font-geist\)/);
  assert.match(globals, /--typeset-font-mono: var\(--font-geist-mono\)/);
  assert.match(globals, /--typeset-size: 16px/);
  assert.match(globals, /--typeset-leading: 1\.6/);
  assert.match(globals, /--typeset-flow: 1em/);
  assert.equal((globals.match(/@import "\.\/typeset\.css";/g) ?? []).length, 1);
  assert.match(help, /className="typeset typeset-help max-w-\[42em\]"/);
  assert.doesNotMatch(help, /<main className="[^"\n]*\btypeset\b/);
  assert.doesNotMatch(blog, /\btypeset\b/);

  for (const element of ["h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "table"]) {
    assert.match(typesetFixture, new RegExp(`<${element}(?:\\s|>)`));
  }
  assert.match(typesetFixture, /<ul>[\s\S]*?<ul>/);
  assert.match(typesetFixture, /<a href=/);
  assert.match(typesetFixture, /<code>/);
  assert.match(typesetFixture, /typeset-scroll/);
});
