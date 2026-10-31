import { forwardRef, type AnchorHTMLAttributes } from "react";
import { navigate } from "./router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

/** Stand-in for next/link: hash routing, no server. */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch: _p, replace, scroll: _s, onClick, ...rest }, ref) {
  const target = typeof href === "string" ? href : href.pathname ?? "/";
  const external = /^[a-z]+:/i.test(target);
  return (
    <a
      ref={ref}
      href={external ? target : `#${target}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || external || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        navigate(target, replace);
      }}
      {...rest}
    />
  );
});

export default Link;
