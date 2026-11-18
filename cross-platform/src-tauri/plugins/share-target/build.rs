const COMMANDS: &[&str] = &["fetch_pending_share"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build()
}
