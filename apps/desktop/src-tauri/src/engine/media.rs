use super::tools::{require, Tool};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub duration_ms: u64,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub fps: Option<f64>,
    pub has_audio: bool,
    pub has_video: bool,
    pub size_bytes: u64,
}

/// Input must be an existing regular file; it is always passed as `file:<path>` so ffmpeg can never be
/// steered into another protocol (http:, concat:, ...) or mistake a name for an option.
pub fn checked_input(path: &str) -> Result<PathBuf, String> {
    let canonical = Path::new(path).canonicalize().map_err(|_| "файл не найден".to_string())?;
    // Windows returns \\?\C:\... which ffmpeg's file: protocol does not accept.
    let canonical = match canonical.to_str().and_then(|p| p.strip_prefix(r"\\?\")) {
        Some(stripped) => PathBuf::from(stripped),
        None => canonical,
    };
    if !canonical.is_file() {
        return Err("это не файл".into());
    }
    Ok(canonical)
}

pub fn file_arg(path: &Path) -> String {
    format!("file:{}", path.display())
}

fn rate(value: &str) -> Option<f64> {
    let (n, d) = value.split_once('/')?;
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (d > 0.0).then_some(n / d)
}

pub fn probe(path: &str) -> Result<MediaInfo, String> {
    let input = checked_input(path)?;
    let output = Command::new(require(Tool::Ffprobe)?)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(file_arg(&input))
        .output()
        .map_err(|e| format!("ffprobe не запустился: {e}"))?;
    if !output.status.success() {
        return Err("не удалось прочитать файл: это не видео или файл повреждён".into());
    }
    let json: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .or_else(|| video.and_then(|v| v["duration"].as_str()?.parse().ok()))
        .unwrap_or(0.0);
    Ok(MediaInfo {
        path: input.display().to_string(),
        duration_ms: (duration * 1000.0).round() as u64,
        width: video.and_then(|v| v["width"].as_u64()),
        height: video.and_then(|v| v["height"].as_u64()),
        fps: video.and_then(|v| rate(v["avg_frame_rate"].as_str()?)),
        has_audio: audio.is_some(),
        has_video: video.is_some(),
        size_bytes: json["format"]["size"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
    })
}
