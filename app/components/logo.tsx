import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
  tone?: "dark" | "light";
  /** A white mark and wordmark for dark immersive surfaces such as auth. */
  variant?: "default" | "identity";
};

/** The supplied brand geometry is rendered unchanged in every context. */
export function Logo({ className = "", priority = false, tone = "dark", variant = "default" }: LogoProps) {
  return (
    <span className={`brand-logo brand-logo--${variant} ${className}`.trim()}>
      <Image
        src={variant === "identity"
          ? "/assets/hashpix-id-full-logo.svg"
          : tone === "dark" ? "/assets/logo-dark.svg" : "/assets/logo-source.svg"}
        alt="Hashpix"
        width={170}
        height={35}
        priority={priority}
        sizes="(max-width: 600px) 112px, 132px"
      />
    </span>
  );
}
