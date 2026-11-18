/// Sample bridge command (plan T1): returns the shell's package version so
/// the web client can verify the invoke channel once it runs inside Tauri
/// (see apps/web/app/src/platform/native.ts — log-level usage only).
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
