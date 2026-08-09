import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncButton } from "../../components/hashpix/async-button";

test("auth submit loading uses the canonical disabled Vega button", () => {
  const markup = renderToStaticMarkup(createElement(AsyncButton, { loading: true, type: "submit" }, "Войти"));

  assert.match(markup, /data-slot="button"/);
  assert.match(markup, /h-9/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
});

test("auth route source uses canonical form primitives without its legacy stylesheet", async () => {
  const source = await readFile(new URL("../../app/sign-in/page.tsx", import.meta.url), "utf8");

  assert.match(source, /@\/components\/ui\/card/);
  assert.match(source, /@\/components\/ui\/field/);
  assert.match(source, /@\/components\/ui\/input-otp/);
  assert.match(source, /@\/components\/hashpix\/async-button/);
  assert.doesNotMatch(source, /lucide-react|sign-in\.css|className=["'][^"']*\bauth-/);
});
