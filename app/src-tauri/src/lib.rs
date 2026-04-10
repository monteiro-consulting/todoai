use std::fs;
use std::env;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

/// Global handle to the backend Python process so we can kill it on exit.
static BACKEND_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Resolve the project root (parent of the `app` directory).
fn project_root() -> PathBuf {
    // In dev the exe is in app/src-tauri/target/debug/
    // In prod the exe could be anywhere, so we also check relative to exe.
    let exe = env::current_exe().unwrap_or_default();

    // Walk up from exe looking for backend/run.py
    let mut dir = exe.parent().map(|p| p.to_path_buf());
    while let Some(d) = dir {
        if d.join("backend").join("run.py").exists() {
            return d;
        }
        dir = d.parent().map(|p| p.to_path_buf());
    }

    // Fallback: hardcoded project path
    PathBuf::from(r"C:\Users\vmont\todoto")
}

/// Start the FastAPI backend as a child process.
fn start_backend() {
    let root = project_root();
    let backend_dir = root.join("backend");
    let venv_python = backend_dir.join("venv").join("Scripts").join("python.exe");

    let python = if venv_python.exists() {
        venv_python
    } else {
        PathBuf::from("python")
    };

    match Command::new(&python)
        .arg("run.py")
        .current_dir(&backend_dir)
        .spawn()
    {
        Ok(child) => {
            eprintln!("[TodoAI] Backend started (pid {})", child.id());
            if let Ok(mut guard) = BACKEND_PROCESS.lock() {
                *guard = Some(child);
            }
        }
        Err(e) => {
            eprintln!("[TodoAI] Failed to start backend: {}", e);
        }
    }
}

/// Kill the backend process if it's still running.
fn stop_backend() {
    if let Ok(mut guard) = BACKEND_PROCESS.lock() {
        if let Some(ref mut child) = *guard {
            eprintln!("[TodoAI] Stopping backend (pid {})...", child.id());
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[TodoAI] Backend stopped.");
        }
        *guard = None;
    }
}

/// Find the claude CLI executable.
/// Tauri apps don't always inherit the user's full PATH,
/// so we check common install locations.
fn find_claude() -> String {
    // Check if claude is directly available in PATH
    if let Ok(output) = Command::new("where").arg("claude").output() {
        let out = String::from_utf8_lossy(&output.stdout);
        for line in out.lines() {
            let line = line.trim();
            if line.ends_with("claude.cmd") || line.ends_with("claude.exe") {
                return line.to_string();
            }
        }
    }

    // Common locations for npm global installs on Windows
    if let Ok(home) = env::var("USERPROFILE") {
        let npm_cmd = PathBuf::from(&home).join("AppData\\Roaming\\npm\\claude.cmd");
        if npm_cmd.exists() {
            return npm_cmd.display().to_string();
        }
    }

    // Fallback: hope it's in PATH
    "claude".to_string()
}

#[tauri::command]
fn exec_cmd(cwd: String, command: String) -> Result<String, String> {
    let output = Command::new("cmd")
        .args(["/c", &command])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to execute: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !stderr.is_empty() && stdout.is_empty() {
        Ok(stderr)
    } else if !stderr.is_empty() {
        Ok(format!("{}\n{}", stdout, stderr))
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
fn open_terminal(cwd: String) -> Result<(), String> {
    // Try Windows Terminal first
    let result = Command::new("wt")
        .args(["new-tab", "-d", &cwd])
        .spawn();

    if result.is_ok() {
        return Ok(());
    }

    // Fallback: cmd.exe
    Command::new("cmd")
        .args(["/c", "start", "cmd", "/k", &format!("cd /d \"{}\"", cwd)])
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn exec_claude(cwd: String, prompt: String, continue_conversation: bool) -> Result<String, String> {
    // Run the blocking process on a background thread so the UI stays responsive
    tauri::async_runtime::spawn_blocking(move || {
        use std::process::Stdio;
        use std::io::Write;

        // Write prompt to a temp file to avoid shell escaping issues on Windows
        let temp_dir = env::temp_dir();
        let prompt_file = temp_dir.join("todoai_exec_prompt.md");
        fs::write(&prompt_file, &prompt).map_err(|e| format!("Failed to write prompt file: {}", e))?;
        let mut args: Vec<String> = vec![
            "-p".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];
        if continue_conversation {
            args.push("--continue".to_string());
        }

        let claude_bin = find_claude();

        // Read prompt from file and pass via stdin to avoid batch file argument issues
        let prompt_content = fs::read_to_string(&prompt_file)
            .map_err(|e| format!("Failed to read prompt file: {}", e))?;

        let mut child = Command::new(&claude_bin)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("CLAUDECODE")
            .spawn()
            .map_err(|e| format!("Failed to start Claude ({}): {}", claude_bin, e))?;

        // Write prompt to stdin
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt_content.as_bytes())
                .map_err(|e| format!("Failed to write to Claude stdin: {}", e))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Claude process error: {}", e))?;

        // Clean up temp file
        let _ = fs::remove_file(&prompt_file);

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() && stdout.is_empty() {
            return Err(if stderr.is_empty() {
                format!("Claude exited with code {}", output.status)
            } else {
                stderr
            });
        }

        Ok(if stdout.is_empty() { stderr } else { stdout })
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?
}

#[tauri::command]
fn launch_claude_terminal(cwd: String) -> Result<(), String> {
    let cmd = format!(
        "cd /d \"{}\" && set CLAUDECODE= && claude",
        cwd
    );

    let result = Command::new("wt")
        .args(["new-tab", "-d", &cwd, "cmd", "/k", &cmd])
        .env_remove("CLAUDECODE")
        .spawn();

    if result.is_ok() {
        return Ok(());
    }

    Command::new("cmd")
        .args(["/c", "start", "cmd", "/k", &cmd])
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

#[derive(serde::Deserialize)]
struct SubtaskInfo {
    id: String,
    title: String,
    notes: Option<String>,
    tags: Vec<String>,
}

#[tauri::command]
fn launch_goai(path: String, prompt: String, task_id: String, subtasks: Vec<SubtaskInfo>) -> Result<(), String> {
    let temp_dir = env::temp_dir();
    let prompt_file = temp_dir.join("todoai_goai_prompt.md");
    fs::write(&prompt_file, &prompt).map_err(|e| e.to_string())?;
    let prompt_path = prompt_file.display().to_string();

    let ps_file = temp_dir.join("todoai_goai_run.ps1");

    let mut ps_lines: Vec<String> = vec![
        "$env:CLAUDECODE = $null".into(),
        "$env:CLAUDE_CODE_ENTRYPOINT = $null".into(),
        format!("$workDir = \"{}\"", path.replace('\\', "\\\\")),
        format!("$parentTaskId = \"{}\"", task_id),
        String::new(),
        format!("$promptFile = \"{}\"", prompt_path.replace('\\', "\\\\")),
        String::new(),
        "Set-Location -Path $workDir -ErrorAction SilentlyContinue".into(),
        "Write-Host ''".into(),
        "Write-Host '[GoAi] Starting agent...' -ForegroundColor Cyan".into(),
        "Write-Host ''".into(),
        String::new(),
        // Launch claude in agent mode (no -p) with the prompt
        "$promptContent = (Get-Content -Raw $promptFile)".into(),
        "& claude --dangerously-skip-permissions $promptContent".into(),
        String::new(),
        "Write-Host ''".into(),
        "Write-Host '[GoAi] Claude finished. Completing task...' -ForegroundColor Yellow".into(),
        String::new(),
    ];

    // Complete subtasks first if any
    for st in &subtasks {
        ps_lines.push("try {".into());
        ps_lines.push(format!(
            "    Invoke-RestMethod -Uri \"http://127.0.0.1:18427/api/tasks/{}/complete\" -Method Post -ContentType \"application/json\" | Out-Null",
            st.id
        ));
        ps_lines.push("} catch { }".into());
    }

    // Complete parent task
    ps_lines.push("try {".into());
    ps_lines.push(format!(
        "    Invoke-RestMethod -Uri \"http://127.0.0.1:18427/api/tasks/{}/complete\" -Method Post -ContentType \"application/json\" | Out-Null",
        task_id
    ));
    ps_lines.push(format!(
        "    Write-Host '[GoAi] Task marked as done.' -ForegroundColor Green",
    ));
    ps_lines.push("} catch {".into());
    ps_lines.push("    Write-Host \"[GoAi] Failed to complete task: $_\" -ForegroundColor Red".into());
    ps_lines.push("}".into());

    ps_lines.push(String::new());
    ps_lines.push("Write-Host ''".into());
    ps_lines.push("Write-Host '[GoAi] Session complete.' -ForegroundColor Green".into());

    let ps_content = ps_lines.join("\n");
    fs::write(&ps_file, &ps_content).map_err(|e| e.to_string())?;
    let ps_path = ps_file.display().to_string();

    // Try Windows Terminal first
    let result = std::process::Command::new("wt")
        .args(["new-tab", "-d", &path, "powershell", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", &ps_path])
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .spawn();

    if result.is_ok() {
        return Ok(());
    }

    // Fallback: cmd.exe launching powershell
    std::process::Command::new("cmd")
        .args(["/c", "start", "powershell", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", &ps_path])
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![launch_goai, exec_cmd, open_terminal, exec_claude, launch_claude_terminal])
        .setup(|_app| {
            start_backend();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                stop_backend();
            }
        });
}
