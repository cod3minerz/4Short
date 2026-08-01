export const blogCategories = [
  "Нарезка",
  "YouTube",
  "Подкасты",
  "Субтитры",
  "Монтаж",
] as const;

export type BlogCategory = (typeof blogCategories)[number];

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  category: BlogCategory;
  tags: string[];
  publishedAt: string;
  modifiedAt?: string;
  readingTime: number;
  author: "Редакция Hashpix";
  featured: boolean;
  cover: string;
  ogImage: string;
  toc: Array<{ id: string; title: string; level: 2 | 3 }>;
  related: string[];
  ctaTitle: string;
  ctaDescription: string;
};
