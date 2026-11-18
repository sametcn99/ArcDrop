// Desktop entry point. The actual setup lives in the library crate so the
// same code is loaded by the mobile platform frameworks (Android/iOS).
// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    arcdrop_lib::run()
}
