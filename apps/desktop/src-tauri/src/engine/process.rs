use super::jobs::JobCtl;
use std::collections::VecDeque;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

/// Splits a byte stream on both \n and \r (progress bars redraw with \r).
fn pump_lines<R: Read + Send + 'static>(mut reader: R, tx: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for &byte in &chunk[..n] {
                        if byte == b'\n' || byte == b'\r' {
                            if !line.is_empty() {
                                let _ = tx.send(String::from_utf8_lossy(&line).into_owned());
                                line.clear();
                            }
                        } else {
                            line.push(byte);
                        }
                    }
                }
            }
        }
        if !line.is_empty() {
            let _ = tx.send(String::from_utf8_lossy(&line).into_owned());
        }
    });
}

/// Runs a child process, feeding every output line to `on_line`, and kills it as soon as the job is cancelled.
pub fn run_streaming(ctl: &JobCtl, mut cmd: Command, mut on_line: impl FnMut(&str)) -> Result<(), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("не удалось запустить процесс: {e}"))?;
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(out) = child.stdout.take() {
        pump_lines(out, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        pump_lines(err, tx.clone());
    }
    drop(tx);

    let mut tail: VecDeque<String> = VecDeque::with_capacity(12);
    loop {
        if ctl.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelled".into());
        }
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(line) => {
                if tail.len() == 12 {
                    tail.pop_front();
                }
                tail.push_back(line.clone());
                on_line(&line);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "процесс завершился с кодом {}: {}",
            status.code().map_or("?".to_string(), |c| c.to_string()),
            tail.into_iter().collect::<Vec<_>>().join(" | ")
        ))
    }
}
