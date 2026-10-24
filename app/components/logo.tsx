import Image from "next/image";

type LogoProps = {
  className?: string;
  priority?: boolean;
  markOnly?: boolean;
  tone?: "dark" | "light";
  /** Retained for existing call sites; Narezai's supplied lockup is designed for dark surfaces. */
  variant?: "default" | "identity";
};

/** The supplied brand geometry is rendered unchanged in every context. */
export function Logo({ className = "", priority = false, markOnly = false, variant = "default" }: LogoProps) {
  return (
    <span className={`brand-logo brand-logo--${variant}${markOnly ? " brand-logo--mark" : ""} ${className}`.trim()}>
      <Image
        src={markOnly ? "/assets/logo-narezai-mark.svg" : "/assets/logo-narezai.svg"}
        alt="Narezai"
        width={markOnly ? 22 : 170}
        height={markOnly ? 40 : 35}
        priority={priority}
        sizes="(max-width: 600px) 112px, 132px"
      />
    </span>
  );
}
