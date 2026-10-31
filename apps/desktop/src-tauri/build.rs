fn main() {
    // Dev builds look for sidecars as binaries/<name>-<target triple>.
    println!(
        "cargo:rustc-env=NAREZAI_TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build()
}
