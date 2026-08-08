import { cn } from "@/lib/utils";

type PlatformLogoName = "youtube" | "vk" | "rutube" | "twitch";

const PLATFORM_LOGOS: Record<PlatformLogoName, { alt: string; src: string }> = {
  youtube: { alt: "YouTube", src: "/assets/platform-youtube.svg" },
  vk: { alt: "VK Видео", src: "/assets/platform-vk.png" },
  rutube: { alt: "RuTube", src: "/assets/platform-rutube.png" },
  twitch: { alt: "Twitch", src: "/assets/platform-twitch.svg" },
};

/** Official platform artwork, kept separate from the generic product icon set. */
export function PlatformLogo({ name, className }: { name: PlatformLogoName; className?: string }) {
  const logo = PLATFORM_LOGOS[name];
  // eslint-disable-next-line @next/next/no-img-element -- local official brand artwork is intentionally rendered at its native simple icon size.
  return <img className={cn("platform-logo", className)} src={logo.src} alt={logo.alt} />;
}
