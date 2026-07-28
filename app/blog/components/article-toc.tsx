"use client";

import { track } from "../../lib/analytics";
import type { BlogPostMeta } from "../types";

export function ArticleToc({
  slug,
  items,
  mobile = false,
}: {
  slug: string;
  items: BlogPostMeta["toc"];
  mobile?: boolean;
}) {
  const links = (
    <ol>
      {items.map((item) => (
        <li className={item.level === 3 ? "is-nested" : ""} key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={() => track("article_toc_click", { slug, heading: item.id })}
          >
            {item.title}
          </a>
        </li>
      ))}
    </ol>
  );

  if (mobile) {
    return (
      <details className="article-toc article-toc--mobile">
        <summary>Содержание</summary>
        {links}
      </details>
    );
  }

  return (
    <nav className="article-toc article-toc--desktop" aria-label="Содержание статьи">
      <span>Содержание</span>
      {links}
    </nav>
  );
}
