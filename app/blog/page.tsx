import type { Metadata } from "next";
import { Header, Notice } from "../components/interactive-landing";
import { SiteFooter } from "../components/site-footer";
import { BlogExplorer } from "./components/blog-explorer";
import { postMetadata } from "./registry";

export const metadata: Metadata = {
  title: "Блог о коротких видео, Shorts и Reels",
  description:
    "Практические материалы Hashpix о нарезке длинных видео, субтитрах, вертикальном кадре, подкастах и YouTube Shorts.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "Практика коротких видео — блог Hashpix",
    description: "Разбираем нарезку, субтитры, вертикальный формат и работу с длинными видео.",
    url: "/blog",
    images: [{ url: "/assets/hero-landscape.webp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Практика коротких видео — блог Hashpix",
    description: "Разбираем нарезку, субтитры и вертикальный формат.",
    images: ["/assets/hero-landscape.webp"],
  },
};

export default function BlogPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hashpix.ru";
  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Блог Hashpix",
    description: metadata.description,
    url: `${base}/blog`,
    inLanguage: "ru-RU",
    blogPost: postMetadata.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.modifiedAt ?? post.publishedAt,
      url: `${base}/blog/${post.slug}`,
    })),
  };

  return (
    <>
      <Header />
      <main className="blog-page">
        <section className="blog-hero">
          <div className="container blog-hero__inner">
            <span className="blog-marker">HASHPIX / БЛОГ</span>
            <h1>ПРАКТИКА КОРОТКИХ ВИДЕО</h1>
            <p>
              Разбираем, как находить сильные моменты, собирать вертикальный кадр,
              оформлять субтитры и выпускать больше контента из одного исходника.
            </p>
          </div>
        </section>
        <section className="container blog-catalog" aria-label="Статьи">
          <BlogExplorer posts={postMetadata} />
        </section>
      </main>
      <SiteFooter />
      <Notice />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
      />
    </>
  );
}
