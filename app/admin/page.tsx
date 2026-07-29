import type { Metadata } from "next";
import { AdminConsole } from "./components/admin-console";
import "./admin.css";

export const metadata: Metadata = {
  title: "Управление платформой",
  description: "Закрытая панель управления 4Short.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminConsole />;
}
