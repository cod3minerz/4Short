use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct JobCtl {
    cancelled: AtomicBool,
}

impl JobCtl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Registry of running jobs so the UI can cancel them by id.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Arc<JobCtl>>>);

impl Jobs {
    pub fn register(&self, id: &str) -> Arc<JobCtl> {
        let ctl = Arc::new(JobCtl::default());
        self.0.lock().unwrap().insert(id.to_string(), ctl.clone());
        ctl
    }
    pub fn cancel(&self, id: &str) -> bool {
        match self.0.lock().unwrap().get(id) {
            Some(ctl) => {
                ctl.cancel();
                true
            }
            None => false,
        }
    }
    pub fn finish(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: String,
    stage: String,
    percent: Option<f32>,
    message: Option<String>,
}

pub fn emit(app: &AppHandle, job_id: &str, stage: &str, percent: Option<f32>, message: Option<String>) {
    let _ = app.emit(
        "engine:progress",
        Progress {
            job_id: job_id.to_string(),
            stage: stage.to_string(),
            percent: percent.map(|p| p.clamp(0.0, 100.0)),
            message,
        },
    );
}
