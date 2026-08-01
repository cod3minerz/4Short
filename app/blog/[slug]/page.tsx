import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header, Notice } from "../../components/interactive-landing";
import { SiteFooter } from "../../components/site-footer";
import { ArticleExperience } from "../components/article-experience";
import { BlogCard } from "../components/blog-card";
import { BlogUrlForm } from "../components/blog-url-form";
import { ArticleToc } from "../components/article-toc";
import {
  formatPostDate,
  getAdjacentPosts,
  getPost,
  getRelatedPosts,
  postMetadata,
} from "../registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return postMetadata.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  const meta = post.metadata;

  return {
    title: meta.title,
    description: meta.description,
    authors: [{ name: meta.author }],
    alternates: { canonical: `/blog/${meta.slug}` },
    openGraph: {
      type: "article",
      locale: "ru_RU",
      title: meta.title,
      description: meta.description,
      url: `/blog/${meta.slug}`,
      publishedTime: meta.publishedAt,
      modifiedTime: meta.modifiedAt,
      authors: [meta.author],
      tags: meta.tags,
      images: [{ url: meta.ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [meta.ogImage],
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const { metadata: meta, Content } = post;
  const related = getRelatedPosts(meta);
  const adjacent = getAdjacentPosts(slug);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://4short.ru";

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: meta.title,
    description: meta.description,
    image: `${base}${meta.ogImage}`,
    datePublished: meta.publishedAt,
    dateModified: meta.modifiedAt ?? meta.publishedAt,
    inLanguage: "ru-RU",
    mainEntityOfPage: `${base}/blog/${meta.slug}`,
    author: { "@type": "Organization", name: meta.author, url: base },
    publisher: { "@type": "Organization", name: "Hashpix", url: base },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: base },
      { "@type": "ListItem", position: 2, name: "Блог", item: `${base}/blog` },
      { "@type": "ListItem", position: 3, name: meta.category, item: `${base}/blog` },
      {
        "@type": "ListItem",
        position: 4,
        name: meta.title,
        item: `${base}/blog/${meta.slug}`,
      },
    ],
  };

  return (
    <>
      <Header />
      <ArticleExperience
        slug={meta.slug}
        ctaTitle={meta.ctaTitle}
        ctaDescription={meta.ctaDescription}
      />
      <main className="article-page">
        <article>
          <header className="article-hero container">
            <nav className="breadcrumbs" aria-label="Хлебные крошки">
              <Link href="/">Главная</Link>
              <ChevronRight size={14} aria-hidden="true" />
              <Link href="/blog">Блог</Link>
              <ChevronRight size={14} aria-hidden="true" />
              <span>{meta.category}</span>
            </nav>
            <span className="article-category">{meta.category}</span>
            <h1>{meta.title}</h1>
            <p className="article-lead">{meta.description}</p>
            <div className="article-byline">
              <span>{meta.author}</span>
              <time dateTime={meta.publishedAt}>{formatPostDate(meta.publishedAt)}</time>
              {meta.modifiedAt ? (
                <span>Обновлено {formatPostDate(meta.modifiedAt)}</span>
              ) : null}
              <span>{meta.readingTime} минут чтения</span>
            </div>
            <div className="article-cover squircle" aria-label="Место для обложки статьи">
              <span>{meta.category}</span>
              <strong>HASHPIX / EDITORIAL</strong>
              <small>Media slot · 3:2 · 1600×1067</small>
            </div>
          </header>

          <div className="container article-layout">
            <ArticleToc slug={meta.slug} items={meta.toc} />
            <div className="article-content">
              <ArticleToc slug={meta.slug} items={meta.toc} mobile />
              <div className="article-prose">
                <Content />
              </div>
            </div>
          </div>

          <section className="container article-end-cta squircle" aria-labelledby="article-end-title">
            <div>
              <span>Следующий шаг</span>
              <h2 id="article-end-title">{meta.ctaTitle}</h2>
              <p>{meta.ctaDescription}</p>
            </div>
            <BlogUrlForm slug={meta.slug} placement="end" />
          </section>

          <section className="container related-posts" aria-labelledby="related-title">
            <div className="related-posts__heading">
              <span>Продолжить чтение</span>
              <h2 id="related-title">ПО ТЕМЕ</h2>
            </div>
            <div className="blog-grid">
              {related.map((item) => (
                <BlogCard key={item.slug} post={item} />
              ))}
            </div>
          </section>

          <nav className="container article-adjacent" aria-label="Соседние статьи">
            {adjacent.previous ? (
              <Link href={`/blog/${adjacent.previous.slug}`}>
                <ArrowLeft size={18} aria-hidden="true" />
                <span>
                  <small>Предыдущая статья</small>
                  {adjacent.previous.title}
                </span>
              </Link>
            ) : <span />}
            {adjacent.next ? (
              <Link href={`/blog/${adjacent.next.slug}`}>
                <span>
                  <small>Следующая статья</small>
                  {adjacent.next.title}
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            ) : <span />}
          </nav>
        </article>
      </main>
      <SiteFooter />
      <Notice />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </>
  );
}
