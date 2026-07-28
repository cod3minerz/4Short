import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
};

/**
 * The supplied brand artwork is rendered as-is.
 * Geometry, lettering and colors come directly from logo2.svg.
 */
export function Logo({ className = "", priority = false }: LogoProps) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <Image
        src="/assets/logo-source.svg"
        alt="4Short"
        width={170}
        height={50}
        priority={priority}
        sizes="(max-width: 600px) 112px, 132px"
      />
    </span>
  );
}
