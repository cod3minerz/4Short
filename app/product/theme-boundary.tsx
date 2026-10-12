"use client";

import { I18nProvider } from "@heroui/react";
import { RouterProvider, UNSAFE_PortalProvider } from "react-aria";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import "./product.css";

/** One locale, router and portal destination for every product overlay. */
export function ProductThemeBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const portal = useRef<HTMLDivElement>(null);
  const getContainer = useCallback(() => portal.current, []);
  return (
    <I18nProvider locale="ru-RU">
      <RouterProvider navigate={router.push}>
        <div className="hashpix-product" data-theme="dark">
          <UNSAFE_PortalProvider getContainer={getContainer}>{children}</UNSAFE_PortalProvider>
          <div ref={portal} data-product-portals="" />
        </div>
      </RouterProvider>
    </I18nProvider>
  );
}
