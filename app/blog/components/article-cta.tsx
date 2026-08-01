import { BlogUrlForm } from "./blog-url-form";

export function InlineArticleCta({
  slug,
  title,
  description,
}: {
  slug: string;
  title: string;
  description: string;
}) {
  return (
    <aside className="article-inline-cta squircle" aria-label="Попробовать Hashpix">
      <span>Попробуйте на своём видео</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <BlogUrlForm slug={slug} placement="inline" />
    </aside>
  );
}

export function ArticleCallout({ children }: { children: React.ReactNode }) {
  return <aside className="article-callout">{children}</aside>;
}
