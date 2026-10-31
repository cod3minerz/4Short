"use client";

import { useSyncExternalStore } from "react";
import { track } from "../lib/analytics";
import { megabytes, type Release, type ReleaseFile } from "@/lib/releases";

type Os = "mac" | "windows" | "other";

const subscribe = () => () => {};

function detect(): Os {
  const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (platform.includes("mac") || ua.includes("macintosh")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  return "other";
}

/** Server and first client render say "other"; the real value is read after hydration without an effect. */
export function useOs(): Os {
  return useSyncExternalStore(subscribe, detect, () => "other");
}

const labels = {
  mac: { name: "Mac", req: "macOS 13+, Apple Silicon" },
  windows: { name: "Windows", req: "Windows 10 и 11, x64" },
} as const;

function Item({ platform, file, release, primary, location }: { platform: "mac" | "windows"; file?: ReleaseFile; release: Release | null; primary: boolean; location: string }) {
  const label = labels[platform];
  const variant = primary ? "lp-btn--primary" : "lp-btn--secondary";
  return (
    <div className="lp-dl">
      {file ? (
        <a className={`lp-btn ${variant}`} href={file.url} onClick={() => track("desktop_download_click", { platform, location, version: release?.version })}>
          Скачать для {label.name}
        </a>
      ) : (
        <span className="lp-btn" aria-disabled="true" role="link">
          Для {label.name}: скоро
        </span>
      )}
      <small>
        {label.req}
        {file && release ? ` · ${megabytes(file.bytes)} · v${release.version}` : ""}
      </small>
    </div>
  );
}

export function DownloadPair({ release, location }: { release: Release | null; location: string }) {
  const os = useOs();
  return (
    <>
      <Item platform="mac" file={release?.mac} release={release} primary={os !== "windows"} location={location} />
      <Item platform="windows" file={release?.windows} release={release} primary={os !== "mac"} location={location} />
    </>
  );
}

export function HeaderDownload({ release }: { release: Release | null }) {
  const os = useOs();
  const file = os === "mac" ? release?.mac : os === "windows" ? release?.windows : undefined;
  if (file && (os === "mac" || os === "windows")) {
    return (
      <a className="lp-btn lp-btn--primary lp-btn--s" href={file.url} onClick={() => track("desktop_download_click", { platform: os, location: "header", version: release?.version })}>
        Скачать для {labels[os].name}
      </a>
    );
  }
  return <a className="lp-btn lp-btn--primary lp-btn--s" href="#download">Скачать</a>;
}
