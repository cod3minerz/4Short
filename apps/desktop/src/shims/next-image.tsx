import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; priority?: boolean; fill?: boolean; sizes?: string; unoptimized?: boolean; quality?: number; placeholder?: string; loader?: unknown };

export default function Image({ priority: _p, fill: _f, sizes: _s, unoptimized: _u, quality: _q, placeholder: _ph, loader: _l, alt = "", ...rest }: Props) {
  return <img alt={alt} {...rest} />;
}
