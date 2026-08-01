import type { Metadata } from "next";
import "./admin.css";
import "./admin-minimal.css";

export const metadata: Metadata = {
  title: "Управление платформой",
  description: "Закрытая панель управления Hashpix.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
