/// Sample bridge command (plan T1): returns the shell's package version so
/// the web client can verify the invoke channel once it runs inside Tauri
/// (see apps/web/app/src/platform/native.ts — log-level usage only).
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `mut` is only needed on desktop (the cfg block below reassigns the
    // builder); on mobile the block compiles out and unused_mut would fire
    // under the mobile toolchain's deny-warnings flags.
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // Desktop-only wiring (plan T3): single-instance must register FIRST so
    // a second launch (e.g. from an arcdrop:// deep link on Windows/Linux)
    // hands its argv to the running instance instead of opening a new one.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
                // The deep-link plugin already emitted the event to the web
                // client for matching argv URLs.
            }))
            .plugin(tauri_plugin_deep_link::init());
    }

    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(arcdrop_share_target::init())
        .invoke_handler(tauri::generate_handler![app_version])
        .setup(|app| {
            // On mobile the desktop block below compiles out and `app` would
            // be an unused closure parameter — consume it explicitly there.
            #[cfg(mobile)]
            let _ = &app;

            // Associate arcdrop:// with this app on Windows/Linux (registry /
            // desktop file). The scheme is also statically configured in
            // tauri.conf.json (bundle-level); this covers the first run
            // before any installer-level association exists.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register("arcdrop")?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
