import { navigate, useLocation } from "./router";

export const usePathname = () => useLocation().split("?")[0];

export function useSearchParams() {
  return new URLSearchParams(useLocation().split("?")[1] ?? "");
}

export function useRouter() {
  return {
    push: (to: string) => navigate(to),
    replace: (to: string) => navigate(to, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => undefined,
    prefetch: () => undefined,
  };
}
