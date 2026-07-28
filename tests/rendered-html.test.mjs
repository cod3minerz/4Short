import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /class="hero-title-secondary"/);
  assert.match(html, /<span>КОНТЕНТ<\/span><span>НА НЕДЕЛИ\.<\/span>/);
  assert.match(html, /placeholder="Вставьте ссылку на YouTube"/);
  assert.match(html, /Создать шортсы/);
  assert.match(html, /СПИКЕР ВСЕГДА ОСТАЁТСЯ В КАДРЕ/);
  assert.match(html, /СЛОВА СТАНОВЯТСЯ ЧАСТЬЮ ВИДЕО/);
  assert.match(html, /ДОБАВЛЯЙТЕ ОФФЕРЫ ПРЯМО В РОЛИК/);
  assert.match(html, /ОБРАБАТЫВАЙТЕ НЕСКОЛЬКО ИСХОДНИКОВ/);
  assert.match(html, /\/assets\/logo-dark\.svg/);
  assert.match(html, /\/assets\/logo-source\.svg/);
  assert.match(html, /ВЫБЕРИТЕ СВОЙ ОБЪЁМ/);
  assert.match(html, /ДОБАВЬТЕ МИНУТЫ, НЕ МЕНЯЯ ТАРИФ/);
  assert.match(html, /ОТВЕТЫ БЕЗ МЕЛКОГО ШРИФТА/);
});

test("ships SEO metadata and the product story", async () => {
  const html = await (await render()).text();

  assert.match(html, /rel="canonical" href="https:\/\/4short\.ru\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /SoftwareApplication/);
  assert.match(html, /FAQPage/);

  assert.match(html, /id="features"/);
  assert.match(html, /ВСЁ, ЧТО НУЖНО ДЛЯ КОРОТКОГО ВИДЕО/);
  assert.doesNotMatch(html, /scroll-cue/);
});

test("keeps the approved visual assets and interaction rules in source", async () => {
  const [css, logo] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/logo-dark.svg", import.meta.url), "utf8"),
  ]);

  assert.match(css, /url\("\/assets\/hero-landscape\.webp"\)/);
  assert.match(css, /\.url-form__row:focus-within/);
  assert.match(css, /\.mobile-drawer \.drawer__dialog/);
  assert.match(css, /width:\s*100vw\s*!important/);
  assert.match(css, /\.pricing-shell[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.product-series__group[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.product-series__group[\s\S]*?top:\s*88px/);
  assert.match(css, /\.product-series__group::before[\s\S]*?background:\s*white/);
  assert.doesNotMatch(css, /\.product-feature__visual::after/);
  assert.doesNotMatch(css, /\.product-feature__visual\s*\{[^}]*box-shadow/);
  assert.doesNotMatch(css, /\.scroll-cue\s*\{/);
  assert.match(logo, /path:first-of-type\s*\{\s*fill:\s*#202b35/);
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

test("server-renders the blog index and its SEO cluster", async () => {
  const response = await render("/blog");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /ПРАКТИКА КОРОТКИХ ВИДЕО/);
  assert.match(html, /Как превратить длинное видео в короткие ролики/);
  assert.match(html, /Как сделать Shorts из видео YouTube/);
  assert.match(html, /Автоматические субтитры для вертикальных видео/);
  assert.match(html, /rel="canonical" href="https:\/\/4short\.ru\/blog"/);
  assert.match(html, /"@type":"Blog"/);
});

test("server-renders an article with metadata, content and conversion points", async () => {
  const response = await render("/blog/youtube-to-shorts");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<h1>Как сделать Shorts из видео YouTube<\/h1>/);
  assert.match(html, /Подготовьте ссылку и цель/);
  assert.match(html, /Вставьте ссылку — не нужно предварительно скачивать файл/);
  assert.match(html, /"@type":"BlogPosting"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /rel="canonical" href="https:\/\/4short\.ru\/blog\/youtube-to-shorts"/);
});

test("lists blog routes in sitemap and serves RSS", async () => {
  const [sitemap, rss] = await Promise.all([
    render("/sitemap.xml"),
    render("/blog/rss.xml"),
  ]);

  assert.equal(sitemap.status, 200);
  assert.equal(rss.status, 200);
  assert.match(await sitemap.text(), /https:\/\/4short\.ru\/blog\/ai-video-clipping/);
  assert.match(rss.headers.get("content-type") ?? "", /application\/rss\+xml/);
  assert.match(await rss.text(), /<title>Блог 4Short<\/title>/);
});
