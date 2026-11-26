fn main() {
    // The pinned NDK r27 does not default to 16 KiB ELF alignment.
    if matches!(
        std::env::var("TARGET").as_deref(),
        Ok("aarch64-linux-android" | "x86_64-linux-android")
    ) {
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg-cdylib=-Wl,-z,common-page-size=16384");
    }
    tauri_build::build()
}
