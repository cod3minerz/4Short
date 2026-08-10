import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-geist" });
// Mono is used only inside the Help rich-content boundary. Keep it available
// through next/font, without making every route preload a non-critical face.
const geistMono = Geist_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-geist-mono", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://hashpix.ru"),
  title: { default: "Hashpix — AI-нарезка видео", template: "%s | Hashpix" },
  description: "Превращайте длинные видео в готовые Shorts, Reels, TikTok и VK Клипы.",
  icons: { icon: "/assets/logo-source.svg", shortcut: "/assets/logo-source.svg" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "Hashpix",
    title: "Одно видео. Контент на недели.",
    description: "Hashpix превращает длинные видео в готовые вертикальные ролики.",
  },
  twitter: { card: "summary_large_image", title: "Hashpix", description: "Одно видео. Контент на недели." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={cn("dark font-sans", geist.variable, geistMono.variable)}><body><TooltipProvider>{children}</TooltipProvider></body></html>;
}
