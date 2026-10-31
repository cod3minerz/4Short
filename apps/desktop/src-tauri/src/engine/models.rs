use super::jobs::{emit, JobCtl};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    /// Sanity floor: a truncated download is rejected even when the server did not send Content-Length.
    pub min_bytes: u64,
}

const TURBO: ModelSpec = ModelSpec {
    id: "large-v3-turbo-q5_0",
    file: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    min_bytes: 500_000_000,
};

const SMALL: ModelSpec = ModelSpec {
    id: "small-q5_1",
    file: "ggml-small-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
    min_bytes: 150_000_000,
};

/// large-v3-turbo quantised needs ~1.5-2 GB of RAM at runtime; below 6 GB total fall back to small.
pub fn pick(total_ram_bytes: u64) -> &'static ModelSpec {
    if total_ram_bytes >= 6 * 1024 * 1024 * 1024 {
        &TURBO
    } else {
        &SMALL
    }
}

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub installed: bool,
    pub bytes: u64,
    pub sha256: Option<String>,
}

pub fn installed_path(app: &AppHandle, spec: &ModelSpec) -> Option<PathBuf> {
    let path = dir(app).ok()?.join(spec.file);
    let size = fs::metadata(&path).ok()?.len();
    (size >= spec.min_bytes).then_some(path)
}

pub fn info(app: &AppHandle, spec: &ModelSpec) -> ModelInfo {
    let path = installed_path(app, spec);
    ModelInfo {
        id: spec.id.to_string(),
        installed: path.is_some(),
        bytes: path.as_ref().and_then(|p| fs::metadata(p).ok()).map_or(0, |m| m.len()),
        sha256: path.and_then(|p| fs::read_to_string(p.with_extension("sha256")).ok()),
    }
}

pub fn install(app: &AppHandle, ctl: &JobCtl, job_id: &str, spec: &ModelSpec) -> Result<ModelInfo, String> {
    if installed_path(app, spec).is_some() {
        return Ok(info(app, spec));
    }
    let target = dir(app)?.join(spec.file);
    let part = target.with_extension("part");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(None)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(spec.url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("не удалось скачать модель: {e}"))?;
    let total = response.content_length();
    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    let mut last_percent = -1.0f32;
    loop {
        if ctl.is_cancelled() {
            drop(file);
            let _ = fs::remove_file(&part);
            return Err("cancelled".into());
        }
        let n = response.read(&mut buf).map_err(|e| format!("обрыв загрузки модели: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        hasher.update(&buf[..n]);
        done += n as u64;
        if let Some(total) = total {
            let percent = done as f32 * 100.0 / total as f32;
            if percent - last_percent >= 0.5 {
                last_percent = percent;
                emit(app, job_id, "model", Some(percent), Some(format!("{} / {} МБ", done / 1_000_000, total / 1_000_000)));
            }
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if done < spec.min_bytes || total.is_some_and(|t| t != done) {
        let _ = fs::remove_file(&part);
        return Err("модель скачалась не полностью, повторите".into());
    }
    let digest = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    fs::rename(&part, &target).map_err(|e| e.to_string())?;
    let _ = fs::write(target.with_extension("sha256"), &digest);
    Ok(info(app, spec))
}
