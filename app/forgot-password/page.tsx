import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "../sign-in/page";

export const metadata: Metadata = {
  title: "Восстановить пароль",
  description: "Безопасное восстановление доступа к Hashpix.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <Suspense fallback={null}><AuthScreen initialMode="forgot-password" /></Suspense>;
}
