import type { Metadata } from "next";
import { DashboardShell } from "./components/dashboard-shell";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Проекты, стили и минуты Hashpix.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
