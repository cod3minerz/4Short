#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use engine::jobs::Jobs;
use engine::media::MediaInfo;
use engine::models::{self, ModelInfo};
use engine::tools::{self, Tool};
use engine::transcribe::{total_ram, Transcript};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    os: &'static str,
    arch: &'static str,
    cpus: usize,
    ram_bytes: u64,
    tools: BTreeMap<&'static str, bool>,
    model: ModelInfo,
}

#[tauri::command]
fn engine_status(app: AppHandle) -> EngineStatus {
    let ram = total_ram();
    EngineStatus {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        ram_bytes: ram,
        tools: Tool::ALL.iter().map(|t| (t.stem(), tools::resolve(*t).is_some())).collect(),
        model: models::info(&app, models::pick(ram)),
    }
}

/// Runs blocking engine work off the UI thread and always unregisters the job.
async fn blocking<T: Send + 'static>(
    jobs: &State<'_, Jobs>,
    job_id: &str,
    work: impl FnOnce(std::sync::Arc<engine::jobs::JobCtl>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let ctl = jobs.register(job_id);
    let outcome = tauri::async_runtime::spawn_blocking(move || work(ctl))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    jobs.finish(job_id);
    outcome
}

#[tauri::command]
async fn model_install(app: AppHandle, jobs: State<'_, Jobs>, job_id: String) -> Result<ModelInfo, String> {
    let id = job_id.clone();
    blocking(&jobs, &job_id, move |ctl| models::install(&app, &ctl, &id, models::pick(total_ram()))).await
}

#[tauri::command]
async fn media_probe(path: String) -> Result<MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || engine::media::probe(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn media_download(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    job_id: String,
    url: String,
) -> Result<engine::fetch::Downloaded, String> {
    let id = job_id.clone();
    blocking(&jobs, &job_id, move |ctl| engine::fetch::download(&app, &ctl, &id, &url)).await
}

#[tauri::command]
async fn media_transcribe(
    app: AppHandle,
    jobs: State<'_, Jobs>,
    job_id: String,
    path: String,
    language: Option<String>,
) -> Result<Transcript, String> {
    let id = job_id.clone();
    let language = language.unwrap_or_else(|| "ru".into());
    blocking(&jobs, &job_id, move |ctl| engine::transcribe::run(&app, &ctl, &id, &path, &language)).await
}

#[tauri::command]
fn job_cancel(jobs: State<'_, Jobs>, job_id: String) -> bool {
    jobs.cancel(&job_id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            engine_status,
            model_install,
            media_probe,
            media_download,
            media_transcribe,
            job_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
