import Image from "next/image";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={className} aria-label="4Short">
      <span className="site-logo__mark">
        <Image src="/assets/logo-source.svg" alt="" width={36} height={36} priority />
      </span>
      <strong><i>4</i>Short</strong>
    </span>
  );
}
