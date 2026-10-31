import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string; priority?: boolean; fill?: boolean; sizes?: string };

export default function Image({ priority: _p, fill: _f, sizes: _s, alt = "", ...rest }: Props) {
  return <img alt={alt} {...rest} />;
}
