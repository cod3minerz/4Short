import { postMetadata } from "../registry";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://4short.ru";
  const items = postMetadata
    .map(
      (post) => `
        <item>
          <title>${escapeXml(post.title)}</title>
          <link>${base}/blog/${post.slug}</link>
          <guid isPermaLink="true">${base}/blog/${post.slug}</guid>
          <description>${escapeXml(post.description)}</description>
          <pubDate>${new Date(`${post.publishedAt}T12:00:00Z`).toUTCString()}</pubDate>
        </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Блог Hashpix</title>
        <link>${base}/blog</link>
        <description>Практика коротких видео, нарезки и субтитров.</description>
        <language>ru-RU</language>
        ${items}
      </channel>
    </rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
