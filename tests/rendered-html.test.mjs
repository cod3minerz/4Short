import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the 4Short landing page and its primary action", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<title>4Short — AI-нарезка видео/);
  assert.match(html, /ОДНО ВИДЕО\./);
  assert.match(html, /КОНТЕНТ НА НЕДЕЛИ\./);
  assert.match(html, /placeholder="Вставьте ссылку на YouTube"/);
  assert.match(html, /Создать шортсы/);
  assert.match(html, /\/assets\/logo-source\.svg/);
  assert.match(html, /ВЫБЕРИТЕ СВОЙ ОБЪЁМ/);
  assert.match(html, /ДОБАВЬТЕ МИНУТЫ, НЕ МЕНЯЯ ТАРИФ/);
  assert.match(html, /ОТВЕТЫ БЕЗ МЕЛКОГО ШРИФТА/);
});

test("ships SEO metadata and excludes removed product sections", async () => {
  const html = await (await render()).text();

  assert.match(html, /rel="canonical" href="https:\/\/4short\.ru\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /SoftwareApplication/);
  assert.match(html, /FAQPage/);

  assert.doesNotMatch(html, /Настройте результат/);
  assert.doesNotMatch(html, /Загрузите один раз/);
  assert.doesNotMatch(html, /Три шага/);
  assert.doesNotMatch(html, /Из обычного фрагмента/);
  assert.doesNotMatch(html, /Для тех, у кого уже есть что сказать/);
});

test("serves robots and sitemap routes", async () => {
  const [robots, sitemap] = await Promise.all([
    render("/robots.txt"),
    render("/sitemap.xml"),
  ]);

  assert.equal(robots.status, 200);
  assert.equal(sitemap.status, 200);
  assert.match(await robots.text(), /Sitemap:\s*https:\/\/4short\.ru\/sitemap\.xml/i);
  assert.match(await sitemap.text(), /<loc>https:\/\/4short\.ru\/?<\/loc>/i);
});
