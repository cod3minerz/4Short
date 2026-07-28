"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { track } from "../../lib/analytics";
import { formatPostDate } from "../registry";
import type { BlogPostMeta } from "../types";

export function BlogCard({
  post,
  size = "regular",
}: {
  post: BlogPostMeta;
  size?: "lead" | "compact" | "regular";
}) {
  return (
    <Link
      className={`blog-card blog-card--${size} squircle`}
      href={`/blog/${post.slug}`}
      onClick={() => track("blog_article_click", { slug: post.slug, category: post.category })}
    >
      <div className="blog-card__media" aria-hidden="true">
        <span>{post.category}</span>
        <strong>4S</strong>
      </div>
      <div className="blog-card__content">
        <div className="blog-card__meta">
          <span>{post.category}</span>
          <span>{post.readingTime} мин</span>
        </div>
        <h2>{post.title}</h2>
        <p>{post.description}</p>
        <div className="blog-card__footer">
          <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
          <ArrowUpRight size={20} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
