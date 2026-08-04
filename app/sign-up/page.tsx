import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "../sign-in/page";

export const metadata: Metadata = {
  title: "Создать аккаунт",
  description: "Создайте защищённый аккаунт Hashpix.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return <Suspense fallback={null}><AuthScreen initialMode="sign-up" /></Suspense>;
}
