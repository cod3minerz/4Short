import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Вход в Narezai",
  description: "Безопасный вход в Narezai с подтверждением email.",
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
