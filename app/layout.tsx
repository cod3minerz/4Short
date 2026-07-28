import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://4short.ru"),
  title: { default: "4Short — AI-нарезка видео", template: "%s | 4Short" },
  description: "Превращайте длинные видео в готовые Shorts, Reels, TikTok и VK Клипы.",
  icons: { icon: "/assets/logo-source.svg", shortcut: "/assets/logo-source.svg" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "4Short",
    title: "Одно видео. Контент на недели.",
    description: "4Short превращает длинные видео в готовые вертикальные ролики.",
  },
  twitter: { card: "summary_large_image", title: "4Short", description: "Одно видео. Контент на недели." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={`${dmSans.variable}`}>{children}</body></html>;
}
