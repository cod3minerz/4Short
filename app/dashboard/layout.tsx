import type { Metadata } from "next";
import "./dashboard-geometry.css";
import { DashboardShell } from "./components/dashboard-shell";
import { ProductThemeBoundary } from "../product/theme-boundary";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Проекты и клипы Narezai.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ProductThemeBoundary><DashboardShell>{children}</DashboardShell></ProductThemeBoundary>;
}
