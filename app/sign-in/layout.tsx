import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в Hashpix по коду из письма.",
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
