import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./landing.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://4short.ru"),
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
  return <html lang="ru"><body>{children}</body></html>;
}
