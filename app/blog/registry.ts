import AiVideoClipping, { metadata as aiVideoClippingMeta } from "./posts/ai-video-clipping.mdx";
import AutoSubtitles, { metadata as autoSubtitlesMeta } from "./posts/auto-subtitles.mdx";
import FaceTracking, { metadata as faceTrackingMeta } from "./posts/face-tracking.mdx";
import PodcastToClips, { metadata as podcastToClipsMeta } from "./posts/podcast-to-clips.mdx";
import RemoveSilence, { metadata as removeSilenceMeta } from "./posts/remove-silence.mdx";
import YoutubeToShorts, { metadata as youtubeToShortsMeta } from "./posts/youtube-to-shorts.mdx";
import type { BlogPostMeta } from "./types";

const entries = [
  [aiVideoClippingMeta, AiVideoClipping],
  [youtubeToShortsMeta, YoutubeToShorts],
  [podcastToClipsMeta, PodcastToClips],
  [autoSubtitlesMeta, AutoSubtitles],
  [faceTrackingMeta, FaceTracking],
  [removeSilenceMeta, RemoveSilence],
] as const;

export const posts = entries
  .map(([metadata, Content]) => ({
    metadata: metadata as BlogPostMeta,
    Content,
  }))
  .sort(
    (a, b) =>
      new Date(b.metadata.publishedAt).getTime() - new Date(a.metadata.publishedAt).getTime(),
  );

export const postMetadata = posts.map(({ metadata }) => metadata);

export function getPost(slug: string) {
  return posts.find((post) => post.metadata.slug === slug);
}

export function getRelatedPosts(meta: BlogPostMeta) {
  return meta.related
    .map((slug) => posts.find((post) => post.metadata.slug === slug)?.metadata)
    .filter((post): post is BlogPostMeta => Boolean(post));
}

export function getAdjacentPosts(slug: string) {
  const index = posts.findIndex((post) => post.metadata.slug === slug);
  if (index < 0) return { previous: undefined, next: undefined };
  return {
    previous: posts[index - 1]?.metadata,
    next: posts[index + 1]?.metadata,
  };
}

export function formatPostDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}
