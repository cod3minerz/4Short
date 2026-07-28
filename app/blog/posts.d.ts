declare module "*.mdx" {
  import type { ComponentType } from "react";
  import type { BlogPostMeta } from "./types";

  export const metadata: BlogPostMeta;
  const MDXContent: ComponentType<Record<string, unknown>>;
  export default MDXContent;
}
