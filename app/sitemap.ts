import type { MetadataRoute } from "next";
import { postMetadata } from "./blog/registry";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://4short.ru";
  return [
    {
      url: base,
      lastModified: new Date("2026-07-28T12:00:00Z"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/blog`,
      lastModified: new Date("2026-07-28T12:00:00Z"),
      changeFrequency: "weekly",
      priority: 0.85,
    },
    ...postMetadata.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(`${post.modifiedAt ?? post.publishedAt}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: post.featured ? 0.8 : 0.7,
    })),
  ];
}
