import { I18nProvider } from "@heroui/react";
import { RouterProvider, UNSAFE_PortalProvider } from "react-aria";
import { useCallback, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardShell } from "../../../app/dashboard/components/dashboard-shell";
import { ProjectsView } from "../../../app/dashboard/components/projects-view";
import { ProjectWorkspace } from "../../../app/dashboard/components/project-workspace";
import { ClipEditor } from "../../../app/dashboard/components/clip-editor";
import { BillingView } from "../../../app/dashboard/components/billing-view";
import { AccountView } from "../../../app/dashboard/account/account-view";
import HelpPage from "../../../app/dashboard/help/page";
import { ProductHome } from "../../../app/product/home";
import { SourceConfiguration } from "../../../app/product/source-configuration";
import { navigate, useLocation } from "./shims/router";
import { EnginePage } from "./engine/EnginePage";

/** Same boundary as app/product/theme-boundary.tsx, with hash-aware link hrefs. */
function Boundary({ children }: { children: React.ReactNode }) {
  const portal = useRef<HTMLDivElement>(null);
  const getContainer = useCallback(() => portal.current, []);
  return (
    <I18nProvider locale="ru-RU">
      <RouterProvider navigate={(href) => navigate(String(href))} useHref={(href) => `#${href}`}>
        <div className="hashpix-product" data-theme="dark">
          <UNSAFE_PortalProvider getContainer={getContainer}>{children}</UNSAFE_PortalProvider>
          <div ref={portal} data-product-portals="" />
        </div>
      </RouterProvider>
    </I18nProvider>
  );
}

function Route() {
  const [path, query = ""] = useLocation().split("?");
  const params = new URLSearchParams(query);

  const clip = path.match(/^\/dashboard\/projects\/([^/]+)\/clips\/([^/]+)$/);
  if (clip) return <ClipEditor projectId={clip[1]} clipId={clip[2]} />;
  const project = path.match(/^\/dashboard\/projects\/([^/]+)$/);
  if (project) return <ProjectWorkspace projectId={project[1]} />;
  if (path === "/dashboard/projects") return <ProjectsView />;
  if (path === "/desktop/engine") return <EnginePage />;
  if (path === "/dashboard/billing") return <BillingView />;
  if (path === "/dashboard/account") return <AccountView />;
  if (path === "/dashboard/help") return <HelpPage />;
  if (path === "/dashboard/new" && (params.get("preflight") || params.get("sourceId"))) {
    return <SourceConfiguration preflightId={params.get("preflight") ?? undefined} sourceId={params.get("sourceId") ?? undefined} />;
  }
  return <ProductHome initialSource={params.get("source") ?? ""} />;
}

export function App() {
  return (
    <TooltipProvider>
      <Boundary>
        <DashboardShell>
          <Route />
        </DashboardShell>
        <a href="#/desktop/engine" style={{ position: "fixed", right: 12, bottom: 10, zIndex: 50, fontSize: 12, color: "#a1a1aa" }}>
          Движок
        </a>
      </Boundary>
    </TooltipProvider>
  );
}
