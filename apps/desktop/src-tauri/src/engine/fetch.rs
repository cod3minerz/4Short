use super::jobs::{emit, JobCtl};
use super::process::run_streaming;
use super::tools::{require, Tool};
use serde::Serialize;
use std::fs;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub path: String,
}

fn valid_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.len() > 2048 || url.chars().any(char::is_whitespace) {
        return Err("нужна ссылка вида https://…".into());
    }
    Ok(())
}

/// Downloads a video (up to 1080p) with yt-dlp into the app's media folder.
pub fn download(app: &AppHandle, ctl: &JobCtl, job_id: &str, url: &str) -> Result<Downloaded, String> {
    valid_url(url)?;
    let ytdlp = require(Tool::YtDlp)?;
    let ffmpeg = require(Tool::Ffmpeg)?;
    let ffmpeg_dir = ffmpeg.parent().ok_or("нет папки ffmpeg")?.to_path_buf();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads")
        .join(job_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(ytdlp);
    cmd.args(["--no-playlist", "--no-warnings", "--newline", "--progress", "--restrict-filenames"])
        .args(["--progress-template", "download:NZ %(progress._percent_str)s"])
        .args(["-f", "bv*[height<=1080]+ba/b[height<=1080]/b"])
        .args(["--merge-output-format", "mp4"])
        .arg("--ffmpeg-location").arg(&ffmpeg_dir)
        .arg("-o").arg(dir.join("%(id)s.%(ext)s"))
        .args(["--print", "after_move:NZ_FILE %(filepath)s"])
        .arg("--")
        .arg(url);

    emit(app, job_id, "download", Some(0.0), None);
    let mut file: Option<String> = None;
    let outcome = run_streaming(ctl, cmd, |line| {
        if let Some(rest) = line.strip_prefix("NZ_FILE ") {
            file = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("NZ ") {
            if let Ok(p) = rest.trim().trim_end_matches('%').trim().parse::<f32>() {
                emit(app, job_id, "download", Some(p), None);
            }
        }
    });
    if let Err(error) = outcome {
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }
    match file {
        Some(path) if fs::metadata(&path).is_ok() => Ok(Downloaded { path }),
        _ => Err("загрузка завершилась, но файл не найден".into()),
    }
}
