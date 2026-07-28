"use client";

import { Button, SearchField } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { track } from "../../lib/analytics";
import { blogCategories, type BlogPostMeta } from "../types";
import { BlogCard } from "./blog-card";
import { BlogUrlForm } from "./blog-url-form";

const filters = ["Все", ...blogCategories] as const;

export function BlogExplorer({ posts }: { posts: BlogPostMeta[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("Все");

  useEffect(() => {
    track("blog_view");
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return posts.filter((post) => {
      const matchesCategory = filter === "Все" || post.category === filter;
      const haystack = [post.title, post.description, post.category, ...post.tags]
        .join(" ")
        .toLocaleLowerCase("ru");
      return matchesCategory && (!normalized || haystack.includes(normalized));
    });
  }, [filter, posts, query]);

  const isDefault = !query.trim() && filter === "Все";
  const lead = filtered.find((post) => post.featured) ?? filtered[0];
  const secondary = lead ? filtered.filter((post) => post.slug !== lead.slug).slice(0, 2) : [];
  const remaining = isDefault
    ? filtered.filter((post) => post.slug !== lead?.slug && !secondary.some((item) => item.slug === post.slug))
    : filtered;

  return (
    <>
      <div className="blog-tools">
        <SearchField
          aria-label="Поиск по статьям"
          className="blog-search"
          fullWidth
          value={query}
          variant="secondary"
          onChange={(value) => {
            setQuery(value);
            track("blog_search", { queryLength: value.trim().length });
          }}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Найти тему или инструкцию" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <div className="blog-filters" aria-label="Фильтры статей">
          {filters.map((item) => (
            <Button
              className={filter === item ? "is-active" : ""}
              key={item}
              size="sm"
              variant="secondary"
              onPress={() => {
                setFilter(item);
                track("blog_filter", { filter: item });
              }}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>

      {isDefault && lead ? (
        <div className="blog-featured">
          <BlogCard post={lead} size="lead" />
          <div className="blog-featured__side">
            {secondary.map((post) => (
              <BlogCard key={post.slug} post={post} size="compact" />
            ))}
          </div>
        </div>
      ) : null}

      {remaining.length ? (
        <div className="blog-grid">
          {remaining.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      ) : (
        <div className="blog-empty squircle">
          <h2>Ничего не нашли</h2>
          <p>Попробуйте другой запрос или верните все темы.</p>
          <Button
            variant="secondary"
            onPress={() => {
              setQuery("");
              setFilter("Все");
            }}
          >
            Сбросить фильтры
          </Button>
        </div>
      )}

      <section className="blog-index-cta squircle" aria-labelledby="blog-index-cta-title">
        <div>
          <span>От чтения — к исходнику</span>
          <h2 id="blog-index-cta-title">УЖЕ ЕСТЬ ДЛИННОЕ ВИДЕО?</h2>
          <p>Вставьте ссылку на YouTube и подготовьте её к поиску коротких моментов.</p>
        </div>
        <BlogUrlForm slug="blog-index" placement="index" />
      </section>
    </>
  );
}
