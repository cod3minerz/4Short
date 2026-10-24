import type { Metadata } from "next";
import { AdminShell } from "./components/admin-shell";

export const metadata: Metadata = {
  title: "Управление платформой",
  description: "Закрытая панель управления Narezai.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
