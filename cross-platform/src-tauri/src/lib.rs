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

    // Desktop-only wiring (plan T3/T5): single-instance must register FIRST so
    // a second launch (e.g. from an arcdrop:// deep link on Windows/Linux)
    // hands its argv to the running instance instead of opening a new one.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
                // The deep-link plugin already emitted the event to the web
                // client for matching argv URLs.
            }))
            .plugin(tauri_plugin_deep_link::init())
            // Plan T5: remember window size/position across launches.
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            // Plan T6: desktop auto-update against GitHub Releases (signature
            // key in tauri.conf.json; artifacts+latest.json from the release
            // workflow).
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    // The screenshot workflow uses native WebViews and enables automation only in debug builds.
    #[cfg(all(debug_assertions, feature = "screenshot-webdriver"))]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
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
                use tauri::menu::MenuItem;
                use tauri::tray::TrayIconBuilder;
                use tauri::Manager;
                use tauri_plugin_deep_link::DeepLinkExt;

                app.deep_link().register("arcdrop")?;

                // System tray (plan T5): show/hide the single window and a
                // quit entry — closing the window hides to tray instead of
                // exiting, so the app behaves like a desktop resident.
                let show = MenuItem::with_id(app, "tray-show", "Show ArcDrop", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "tray-quit", "Quit ArcDrop", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
                TrayIconBuilder::with_id("arcdrop-tray")
                    .icon(app.default_window_icon().cloned().ok_or_else(|| {
                        tauri::Error::AssetNotFound("default window icon".to_string())
                    })?)
                    .tooltip("ArcDrop")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "tray-show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "tray-quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Plan T5: closing the window hides it to the tray; the app only
            // exits through the tray Quit entry (desktop builds only). On
            // mobile the desktop block compiles out — consume the params so
            // unused_variable lints don't fail the mobile deny-warnings build.
            #[cfg(mobile)]
            let _ = (&window, &event);

            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
