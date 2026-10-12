import type { Metadata } from "next";
import { DashboardShell } from "./components/dashboard-shell";
import { ProductThemeBoundary } from "../product/theme-boundary";

export const metadata: Metadata = {
  title: "Личный кабинет",
  description: "Проекты и клипы Hashpix.",
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <ProductThemeBoundary><DashboardShell>{children}</DashboardShell></ProductThemeBoundary>;
}
