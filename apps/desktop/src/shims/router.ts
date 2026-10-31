import { useSyncExternalStore } from "react";

const read = () => (window.location.hash.slice(1) || "/dashboard");

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState(null, "", `#${to}`);
  else window.history.pushState(null, "", `#${to}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
};

/** Full location (path + query) as stored in the hash. */
export const useLocation = () => useSyncExternalStore(subscribe, read, () => "/dashboard");
