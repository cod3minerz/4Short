use super::jobs::{emit, JobCtl};
use super::media::{checked_input, file_arg, probe};
use super::models::{installed_path, pick};
use super::process::run_streaming;
use super::tools::{require, Tool};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::process::Command;
use sysinfo::System;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub words: Vec<Word>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub language: String,
    pub duration_ms: u64,
    pub model: String,
    pub elapsed_ms: u64,
    pub segments: Vec<Segment>,
}

pub fn total_ram() -> u64 {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.total_memory()
}

fn percent_in(line: &str) -> Option<f32> {
    // "whisper_print_progress_callback: progress =  45%"
    let rest = line.split("progress =").nth(1)?;
    rest.trim().trim_end_matches('%').trim().parse().ok()
}

fn ffmpeg_seconds(line: &str) -> Option<f64> {
    // "-progress pipe:1" prints out_time_us=1234567
    let value = line.strip_prefix("out_time_us=")?;
    value.trim().parse::<f64>().ok().map(|us| us / 1_000_000.0)
}

fn words_of(tokens: &[Value]) -> Vec<Word> {
    let mut words: Vec<Word> = Vec::new();
    for token in tokens {
        let text = token["text"].as_str().unwrap_or("");
        if text.is_empty() || (text.starts_with("[_") && text.ends_with(']')) {
            continue; // [_BEG_], [_TT_xx] and other control tokens
        }
        let start = token["offsets"]["from"].as_u64().unwrap_or(0);
        let end = token["offsets"]["to"].as_u64().unwrap_or(start);
        match words.last_mut() {
            Some(word) if !text.starts_with(' ') => {
                word.text.push_str(text);
                word.end_ms = end.max(word.end_ms);
            }
            _ => words.push(Word { start_ms: start, end_ms: end, text: text.trim_start().to_string() }),
        }
    }
    words.retain(|w| !w.text.trim().is_empty());
    words
}

pub fn run(app: &AppHandle, ctl: &JobCtl, job_id: &str, path: &str, language: &str) -> Result<Transcript, String> {
    let started = std::time::Instant::now();
    let input = checked_input(path)?;
    let info = probe(path)?;
    if !info.has_audio {
        return Err("в файле нет звуковой дорожки".into());
    }
    let spec = pick(total_ram());
    let model = installed_path(app, spec).ok_or("речевая модель ещё не установлена")?;
    let work = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("jobs")
        .join(job_id);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = (|| -> Result<Transcript, String> {
        // 1. Mono 16 kHz PCM for whisper (0-12% of the job).
        let wav = work.join("audio.wav");
        emit(app, job_id, "audio", Some(0.0), None);
        let mut cmd = Command::new(require(Tool::Ffmpeg)?);
        cmd.args(["-nostdin", "-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i"])
            .arg(file_arg(&input))
            .args(["-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
            .arg(&wav);
        let total_s = (info.duration_ms as f64 / 1000.0).max(1.0);
        run_streaming(ctl, cmd, |line| {
            if let Some(sec) = ffmpeg_seconds(line) {
                emit(app, job_id, "audio", Some((sec / total_s * 12.0) as f32), None);
            }
        })?;

        // 2. whisper.cpp (12-100%).
        let prefix = work.join("out");
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
        let mut cmd = Command::new(require(Tool::Whisper)?);
        cmd.arg("-m").arg(&model)
            .arg("-f").arg(&wav)
            .args(["-l", language])
            .args(["-t", &threads.to_string()])
            .args(["-ojf", "-pp"])
            .arg("-of").arg(&prefix);
        emit(app, job_id, "transcribe", Some(12.0), None);
        run_streaming(ctl, cmd, |line| {
            if let Some(p) = percent_in(line) {
                emit(app, job_id, "transcribe", Some(12.0 + p * 0.88), None);
            }
        })?;

        let json: Value = serde_json::from_slice(&fs::read(prefix.with_extension("json")).map_err(|e| e.to_string())?)
            .map_err(|e| format!("whisper вернул неразборчивый результат: {e}"))?;
        let mut segments = Vec::new();
        for item in json["transcription"].as_array().cloned().unwrap_or_default() {
            let text = item["text"].as_str().unwrap_or("").trim().to_string();
            if text.is_empty() {
                continue;
            }
            let start = item["offsets"]["from"].as_u64().unwrap_or(0);
            let end = item["offsets"]["to"].as_u64().unwrap_or(start);
            let words = words_of(item["tokens"].as_array().map(|v| v.as_slice()).unwrap_or(&[]));
            segments.push(Segment { start_ms: start, end_ms: end.max(start + 1), text, words });
        }
        if segments.is_empty() {
            return Err("в записи не найдено речи".to_string());
        }
        emit(app, job_id, "transcribe", Some(100.0), None);
        Ok(Transcript {
            language: json["result"]["language"].as_str().unwrap_or(language).to_string(),
            duration_ms: info.duration_ms,
            model: spec.id.to_string(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            segments,
        })
    })();
    let _ = fs::remove_dir_all(&work);
    result
}
