use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
    YtDlp,
    Whisper,
}

impl Tool {
    pub const ALL: [Tool; 4] = [Tool::Ffmpeg, Tool::Ffprobe, Tool::YtDlp, Tool::Whisper];

    pub fn stem(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
            Tool::Ffprobe => "ffprobe",
            Tool::YtDlp => "yt-dlp",
            Tool::Whisper => "whisper-cli",
        }
    }
}

/// Sidecars are shipped inside the app bundle, next to the executable. Nothing is taken from PATH.
pub fn resolve(tool: Tool) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let bundled = dir.join(format!("{}{}", tool.stem(), ext));
    if bundled.is_file() {
        return Some(bundled);
    }
    // `tauri dev`: binaries/<name>-<target triple>
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{}-{}{}", tool.stem(), env!("NAREZAI_TARGET_TRIPLE"), ext));
    dev.is_file().then_some(dev)
}

pub fn require(tool: Tool) -> Result<PathBuf, String> {
    resolve(tool).ok_or_else(|| format!("в составе приложения нет компонента {}", tool.stem()))
}
