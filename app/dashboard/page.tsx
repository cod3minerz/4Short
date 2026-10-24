import { ProductHome } from "../product/home";
import { postMetadata } from "../blog/registry";

const blogCovers: Record<string, string> = {
  "remove-silence": "/assets/narezai-blog-podcast.png",
  "face-tracking": "/assets/narezai-blog-speaker.png",
  "auto-subtitles": "/assets/narezai-blog-captions.png",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const params = await searchParams;
  const articles = postMetadata.slice(0, 3).map(({ slug, title, description, category, readingTime }) => ({
    slug,
    title,
    description,
    category,
    readingTime,
    cover: blogCovers[slug] ?? "/assets/hero-landscape.webp",
  }));
  return <ProductHome initialSource={params.source} articles={articles} />;
}
