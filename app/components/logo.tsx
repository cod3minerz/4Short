import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
  tone?: "dark" | "light";
};

/**
 * The supplied brand geometry is rendered unchanged.
 * The light-theme SVG only recolors the original white wordmark.
 */
export function Logo({ className = "", priority = false, tone = "dark" }: LogoProps) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <Image
        src={tone === "dark" ? "/assets/logo-dark.svg" : "/assets/logo-source.svg"}
        alt="4Short"
        width={170}
        height={50}
        priority={priority}
        sizes="(max-width: 600px) 112px, 132px"
      />
    </span>
  );
}
