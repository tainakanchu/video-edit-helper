use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 起動中のサイドカー(Node サーバー)。アプリ終了時に kill する。
#[derive(Default)]
struct ServerProcess(Mutex<Option<CommandChild>>);

/// app_config_dir/settings.json に永続化する最小設定。
#[derive(Serialize, Deserialize, Default)]
struct AppSettings {
    /// ユーザーが選んだデータディレクトリ(未設定なら既定=app_data_dir/project-data)
    data_dir: Option<String>,
    /// ユーザーが選んだキャッシュディレクトリ(未設定なら既定=app_cache_dir/cache)
    cache_dir: Option<String>,
}

#[derive(Serialize)]
struct SetupInfo {
    data_dir: String,
    default_data_dir: String,
    cache_dir: String,
    default_cache_dir: String,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app_config_dir")
        .join("settings.json")
}

fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, s: &AppSettings) -> std::io::Result<()> {
    let p = settings_path(app);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, serde_json::to_string_pretty(s).unwrap_or_default())
}

fn default_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir")
        .join("project-data")
}

/// 実際に使うデータディレクトリ(設定があればそれ、無ければ既定)
fn resolved_data_dir(app: &tauri::AppHandle) -> PathBuf {
    match load_settings(app).data_dir {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => default_data_dir(app),
    }
}

fn default_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .expect("app_cache_dir")
        .join("cache")
}

/// 実際に使うキャッシュディレクトリ(設定があればそれ、無ければ既定)
fn resolved_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    match load_settings(app).cache_dir {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => default_cache_dir(app),
    }
}

/// OS に空きポートを払い出してもらう(127.0.0.1:0 バインド)
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("空きポートの確保に失敗")
}

#[tauri::command]
fn get_setup_info(app: tauri::AppHandle) -> SetupInfo {
    SetupInfo {
        data_dir: resolved_data_dir(&app).to_string_lossy().to_string(),
        default_data_dir: default_data_dir(&app).to_string_lossy().to_string(),
        cache_dir: resolved_cache_dir(&app).to_string_lossy().to_string(),
        default_cache_dir: default_cache_dir(&app).to_string_lossy().to_string(),
    }
}

/// フォルダ選択ダイアログを開き、選ばれたらデータディレクトリとして保存して再起動する。
#[tauri::command]
fn choose_data_dir(app: tauri::AppHandle) {
    if let Some(folder) = app.dialog().file().blocking_pick_folder() {
        if let Some(path) = folder.as_path() {
            let mut s = load_settings(&app);
            s.data_dir = Some(path.to_string_lossy().to_string());
            let _ = save_settings(&app, &s);
            app.restart();
        }
    }
}

/// データディレクトリを既定(app_data_dir)に戻して再起動する。
#[tauri::command]
fn use_default_data_dir(app: tauri::AppHandle) {
    let mut s = load_settings(&app);
    s.data_dir = None;
    let _ = save_settings(&app, &s);
    app.restart();
}

/// フォルダ選択ダイアログを開き、選ばれたらキャッシュディレクトリとして保存して再起動する。
#[tauri::command]
fn choose_cache_dir(app: tauri::AppHandle) {
    if let Some(folder) = app.dialog().file().blocking_pick_folder() {
        if let Some(path) = folder.as_path() {
            let mut s = load_settings(&app);
            s.cache_dir = Some(path.to_string_lossy().to_string());
            let _ = save_settings(&app, &s);
            app.restart();
        }
    }
}

/// キャッシュディレクトリを既定(app_cache_dir)に戻して再起動する。
#[tauri::command]
fn use_default_cache_dir(app: tauri::AppHandle) {
    let mut s = load_settings(&app);
    s.cache_dir = None;
    let _ = save_settings(&app, &s);
    app.restart();
}

/// サイドカー(veh-server)を起動し、stdout の進捗/準備完了を処理する。
/// dev(tauri dev)では beforeDevCommand のサーバー + vite proxy を使うため何もしない。
fn start_server(app: &tauri::AppHandle) {
    if tauri::is_dev() {
        return;
    }

    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[veh] resource_dir 取得失敗: {e}");
            return;
        }
    };
    let whisper_name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let whisper_path = resource_dir.join("whisper").join(whisper_name);
    let web_dist = resource_dir.join("web-dist");

    // 保存先を役割ごとに分ける:
    //  - data_dir  : project.json / backups / 解析結果(文字起こし・シーン・VAD)。
    //                ユーザー選択可(OneDrive 等で同期する用途)
    //  - cache_dir : サムネ・プロキシ等の大容量キャッシュ。マシンローカル(app_cache_dir)
    //  - deps_dir  : ffmpeg/ffprobe・whisper モデル。OS/arch 依存で再取得可なのでローカル永続(app_data_dir)
    let data_dir = resolved_data_dir(app);
    let cache_dir = resolved_cache_dir(app);
    let deps_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => data_dir.clone(),
    };
    let bin_dir = deps_dir.join("bin");
    let models_dir = deps_dir.join("models");
    for d in [&data_dir, &cache_dir, &bin_dir, &models_dir] {
        if let Err(e) = std::fs::create_dir_all(d) {
            eprintln!("[veh] mkdir {d:?} 失敗: {e}");
            return;
        }
    }
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let ffmpeg_path = bin_dir.join(format!("ffmpeg{ext}"));
    let ffprobe_path = bin_dir.join(format!("ffprobe{ext}"));
    let model_path = models_dir.join("ggml-small.bin");

    let port = free_port();

    let sidecar = match app.shell().sidecar("veh-server") {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[veh] サイドカー解決失敗(dev?): {e}");
            return;
        }
    };
    let sidecar = sidecar
        .env("PORT", port.to_string())
        .env("VEH_PROJECT_DIR", data_dir.to_string_lossy().to_string())
        .env("VEH_CACHE_DIR", cache_dir.to_string_lossy().to_string())
        .env("VEH_WEB_DIST", web_dist.to_string_lossy().to_string())
        .env("WHISPER_PATH", whisper_path.to_string_lossy().to_string())
        .env("VEH_WHISPER_MODEL", model_path.to_string_lossy().to_string())
        .env("FFMPEG_PATH", ffmpeg_path.to_string_lossy().to_string())
        .env("FFPROBE_PATH", ffprobe_path.to_string_lossy().to_string())
        .env("VEH_DISABLE_SILERO", "1")
        .env("VEH_AUTO_PROVISION", "1");

    let (mut rx, child) = match sidecar.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[veh] サイドカー起動失敗: {e}");
            return;
        }
    };
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);
    eprintln!("[veh] サイドカー起動: port={port} data_dir={data_dir:?}");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim_end();
                    if let Some(rest) = line.strip_prefix("VEH_SETUP ") {
                        // 進捗 JSON をそのまま splash に転送
                        let _ = app_handle.emit("setup-progress", rest.to_string());
                    } else if let Some(rest) = line.strip_prefix("VEH_READY ") {
                        let ready_port: u16 = rest.trim().parse().unwrap_or(port);
                        let url = format!("http://localhost:{ready_port}/");
                        eprintln!("[veh] サーバー準備完了 port={ready_port} → navigate {url}");
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.eval(&format!("window.location.replace('{url}')"));
                        }
                        let _ = app_handle.emit("setup-ready", ready_port);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[veh-server] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[veh-server] terminated: {:?}", payload.code);
                    let _ = app_handle.emit("setup-progress", "{\"phase\":\"ready\",\"status\":\"error\",\"message\":\"サーバープロセスが終了しました\"}".to_string());
                }
                _ => {}
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerProcess::default())
        .invoke_handler(tauri::generate_handler![
            get_setup_info,
            choose_data_dir,
            use_default_data_dir,
            choose_cache_dir,
            use_default_cache_dir
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            start_server(&app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 終了時にサイドカーを確実に kill する
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
