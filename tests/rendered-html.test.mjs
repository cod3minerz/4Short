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

test("server-renders the Hashpix landing page and its primary action", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<title>Hashpix — AI-клипы из длинных видео \| Hashpix<\/title>/);
  assert.match(html, /<span>Одно видео\.<\/span><span>До 10 коротких клипов\.<\/span>/);
  assert.match(html, /hero-source-form__shell/);
  assert.match(html, /Вставьте ссылку на/);
  assert.match(html, /Создать клипы/);
  assert.match(html, /AI понимает, где в видео начинается самостоятельная мысль\./);
  assert.match(html, /От исходника до клипа — в одном коротком маршруте\./);
  assert.match(html, /\/assets\/logo-source\.svg/);
  assert.match(html, /Выберите объём, который соответствует вашему ритму\./);
  assert.match(html, /Вопросы до старта\./);
});

test("ships SEO metadata and the product story", async () => {
  const html = await (await render()).text();

  assert.match(html, /rel="canonical" href="https:\/\/hashpix\.ru\/"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /SoftwareApplication/);
  assert.match(html, /FAQPage/);

  assert.match(html, /id="features"/);
  assert.match(html, /AI понимает, где в видео начинается самостоятельная мысль\./);
  assert.match(html, /class="dark-landing"/);
});

test("keeps the approved Hashpix visual assets and interaction rules in source", async () => {
  const [css, logo] = await Promise.all([
    readFile(new URL("../app/landing.css", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/logo-source.svg", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.landing-hero__shader\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.hero-source-form__shell:focus-within/);
  assert.match(css, /\.pricing-grid-dark/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(logo, /fill="#3153FF"/);
});

test("serves robots and sitemap routes", async () => {
  const [robots, sitemap] = await Promise.all([
    render("/robots.txt"),
    render("/sitemap.xml"),
  ]);

  assert.equal(robots.status, 200);
  assert.equal(sitemap.status, 200);
  assert.match(await robots.text(), /Sitemap:\s*https:\/\/hashpix\.ru\/sitemap\.xml/i);
  assert.match(await sitemap.text(), /<loc>https:\/\/hashpix\.ru\/?<\/loc>/i);
});

test("server-renders the blog index and its SEO cluster", async () => {
  const response = await render("/blog");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /ПРАКТИКА КОРОТКИХ ВИДЕО/);
  assert.match(html, /Как превратить длинное видео в короткие ролики/);
  assert.match(html, /Как сделать Shorts из видео YouTube/);
  assert.match(html, /Автоматические субтитры для вертикальных видео/);
  assert.match(html, /rel="canonical" href="https:\/\/hashpix\.ru\/blog"/);
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
  assert.match(html, /rel="canonical" href="https:\/\/hashpix\.ru\/blog\/youtube-to-shorts"/);
});

test("lists blog routes in sitemap and serves RSS", async () => {
  const [sitemap, rss] = await Promise.all([
    render("/sitemap.xml"),
    render("/blog/rss.xml"),
  ]);

  assert.equal(sitemap.status, 200);
  assert.equal(rss.status, 200);
  assert.match(await sitemap.text(), /https:\/\/hashpix\.ru\/blog\/ai-video-clipping/);
  assert.match(rss.headers.get("content-type") ?? "", /application\/rss\+xml/);
  assert.match(await rss.text(), /<title>Блог Hashpix<\/title>/);
});

test("server-renders the dashboard and its primary factory entry point", async () => {
  const response = await render("/dashboard");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Создать нарезку/);
  assert.match(html, /Добавьте видео/);
  assert.match(html, /Загрузить[\s\S]*Ссылка[\s\S]*Мои видео/);
  assert.match(html, /Загруженные ранее/);
  assert.match(html, /robots\" content=\"noindex, nofollow/);
});

test("server-renders all primary cabinet surfaces", async () => {
  const [projects, wizard, styles, billing, project] = await Promise.all([
    render("/dashboard/projects"),
    render("/dashboard/new"),
    render("/dashboard/styles"),
    render("/dashboard/billing"),
    render("/dashboard/projects/podcast-24"),
  ]);

  for (const response of [projects, styles, billing, project]) {
    assert.equal(response.status, 200);
  }
  assert.equal(wizard.status, 307);
  assert.equal(new URL(wizard.headers.get("location") ?? "", "http://localhost").pathname, "/dashboard");

  assert.match(await projects.text(), /Исходники, найденные моменты/);
  assert.match(await styles.text(), /Сохраните оформление один раз/);
  assert.match(await billing.text(), /Кредиты списываются один раз/);
  assert.match(await project.text(), /Выберите, что превратить в клипы/);
});

test("server-renders the closed admin surface without mock platform data", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /HASHPIX \/ ADMIN/);
  assert.match(html, /ПРОВЕРЯЕМ ДОСТУП/);
  assert.match(html, /Проверяем активную сессию и платформенную роль/);
  assert.match(html, /robots\" content=\"noindex, nofollow, nocache/);
  assert.doesNotMatch(html, /demo-admin|mock-admin/);
});
