#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::Command;
use std::time::Instant;

#[derive(Serialize)]
struct SysInfo {
    os: &'static str,
    arch: &'static str,
    cpus: usize,
}

#[derive(Serialize)]
struct ToolResult {
    code: Option<i32>,
    millis: u128,
    stdout: String,
    stderr: String,
}

#[tauri::command]
fn sys_info() -> SysInfo {
    SysInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        cpus: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
    }
}

// SPIKE ONLY: runs ffmpeg/ffprobe found on PATH. The production design runs
// bundled sidecars with a server-signed argv and an allowlist of flags.
#[tauri::command]
fn run_tool(program: String, args: Vec<String>) -> Result<ToolResult, String> {
    if program != "ffmpeg" && program != "ffprobe" {
        return Err("program not allowed".into());
    }
    let started = Instant::now();
    let output = Command::new(&program)
        .args(&args)
        .output()
        .map_err(|e| format!("cannot start {program}: {e}"))?;
    let cut = |bytes: &[u8]| {
        let text = String::from_utf8_lossy(bytes);
        text.chars().take(1500).collect::<String>()
    };
    Ok(ToolResult {
        code: output.status.code(),
        millis: started.elapsed().as_millis(),
        stdout: cut(&output.stdout),
        stderr: cut(&output.stderr),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![sys_info, run_tool])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
