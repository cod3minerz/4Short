import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  output: "standalone",
  // The control API uses NodeNext and deliberately retains explicit `.js`
  // specifiers in source imports. Turbopack cannot resolve those specifiers to
  // TypeScript source files. The prebuild hook emits the same contracts to this
  // private local directory, so the browser consumes real ESM without changing
  // the control API's runtime contract.
  turbopack: {
    resolveAlias: {
      "@/packages/contracts/src": "./packages/contracts/dist/index.js",
    },
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: ["rehype-slug"],
  },
});

export default withMDX(nextConfig);
