#!/usr/bin/env python3
"""Prepare the bundled engine binaries for `tauri build` (CI only; do not run on a developer Mac).

Produces src-tauri/binaries/<name>-<target triple>[.exe] for ffmpeg, ffprobe, yt-dlp and whisper-cli.
Downloads are verified against the publisher's checksum file when one exists; the computed sha256 of
every artefact is always printed so it can be pinned.
"""
import hashlib, os, platform, shutil, stat, subprocess, sys, tempfile, urllib.request, zipfile
from pathlib import Path

WHISPER_TAG = "v1.7.6"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "binaries"
OUT.mkdir(parents=True, exist_ok=True)

IS_WIN = platform.system() == "Windows"
TRIPLE = "x86_64-pc-windows-msvc" if IS_WIN else "aarch64-apple-darwin"
EXE = ".exe" if IS_WIN else ""


def fetch(url: str, dest: Path) -> str:
    print(f"GET {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "narezai-ci"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    print(f"  sha256 {digest}  {dest.name}", flush=True)
    return digest


def text(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "narezai-ci"})
        return urllib.request.urlopen(req, timeout=60).read().decode()
    except Exception as e:  # checksum file is best effort
        print(f"  no checksum file at {url}: {e}")
        return None


def verify(digest: str, listing: str | None, name: str):
    if listing is None:
        print(f"  WARNING: {name} not verified against a publisher checksum")
        return
    for line in listing.splitlines():
        parts = line.split()
        if parts and parts[0].lower() == digest and (len(parts) == 1 or parts[-1].lstrip("*").endswith(name)):
            print(f"  checksum OK for {name}")
            return
    # a single-hash file for this artefact
    if listing.strip().split()[0:1] == [digest]:
        print(f"  checksum OK for {name}")
        return
    sys.exit(f"CHECKSUM MISMATCH for {name}")


def install(src: Path, name: str):
    dst = OUT / f"{name}-{TRIPLE}{EXE}"
    shutil.copy2(src, dst)
    dst.chmod(dst.stat().st_mode | 0o111)
    print(f"-> {dst.name} ({dst.stat().st_size // 1024} KiB)")


def unzip_find(archive: Path, wanted: str, into: Path) -> Path:
    with zipfile.ZipFile(archive) as z:
        z.extractall(into)
    for p in into.rglob("*"):
        if p.is_file() and p.name.lower() == wanted.lower():
            return p
    sys.exit(f"{wanted} not found in {archive.name}")


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)

    # ffmpeg / ffprobe (GPL static builds with libx264 and libass)
    if IS_WIN:
        base = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
        name = "ffmpeg-master-latest-win64-gpl.zip"
        z = tmp / name
        verify(fetch(f"{base}/{name}", z), text(f"{base}/checksums.sha256"), name)
        ex = tmp / "ff"
        install(unzip_find(z, "ffmpeg.exe", ex), "ffmpeg")
        install(unzip_find(z, "ffprobe.exe", ex), "ffprobe")
    else:
        base = "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release"
        for tool in ("ffmpeg", "ffprobe"):
            z = tmp / f"{tool}.zip"
            verify(fetch(f"{base}/{tool}.zip", z), text(f"{base}/{tool}.zip.sha256"), f"{tool}.zip")
            install(unzip_find(z, tool, tmp / f"x-{tool}"), tool)

    # yt-dlp
    ybase = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
    yname = "yt-dlp.exe" if IS_WIN else "yt-dlp_macos"
    y = tmp / yname
    verify(fetch(f"{ybase}/{yname}", y), text(f"{ybase}/SHA2-256SUMS"), yname)
    install(y, "yt-dlp")

    # whisper.cpp, built from a pinned tag (static, no GPU runtime dependencies on Windows; Metal on macOS)
    src = tmp / "whisper.cpp"
    subprocess.run(["git", "clone", "--depth", "1", "--branch", WHISPER_TAG, "https://github.com/ggml-org/whisper.cpp", str(src)], check=True)
    print("whisper.cpp commit", subprocess.check_output(["git", "-C", str(src), "rev-parse", "HEAD"], text=True).strip())
    cfg = ["cmake", "-S", str(src), "-B", str(src / "build"), "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF",
           "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_SERVER=OFF", "-DGGML_NATIVE=OFF"]
    if IS_WIN:
        cfg += ["-DGGML_AVX2=ON", "-DGGML_FMA=ON", "-DGGML_F16C=ON", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"]
    else:
        cfg += ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON", "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0", "-DCMAKE_OSX_ARCHITECTURES=arm64"]
    subprocess.run(cfg, check=True)
    subprocess.run(["cmake", "--build", str(src / "build"), "--config", "Release", "--target", "whisper-cli", "-j", "4"], check=True)
    built = next((p for p in (src / "build").rglob(f"whisper-cli{EXE}") if p.is_file()), None)
    if built is None:
        sys.exit("whisper-cli was not produced")
    install(built, "whisper-cli")

if not IS_WIN:
    # Apple Silicon refuses unsigned binaries; ad-hoc sign every sidecar.
    for f in OUT.iterdir():
        subprocess.run(["codesign", "--force", "--sign", "-", str(f)], check=True)

print("sidecars ready:", sorted(p.name for p in OUT.iterdir()))
