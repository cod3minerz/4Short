import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

function HeadingLink({
  as: Tag,
  id,
  children,
  ...props
}: ComponentPropsWithoutRef<"h2"> & { as: "h2" | "h3" }) {
  return (
    <Tag id={id} {...props}>
      {id ? <a href={`#${id}`}>{children}</a> : children}
    </Tag>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => <HeadingLink as="h2" {...props} />,
    h3: (props) => <HeadingLink as="h3" {...props} />,
    a: ({ href = "", ...props }) =>
      href.startsWith("/") ? <Link href={href} {...props} /> : <a href={href} {...props} />,
    ...components,
  };
}
