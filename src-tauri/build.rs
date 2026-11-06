fn main() {
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed=LASTFM_API_KEY");
    println!("cargo:rerun-if-env-changed=LASTFM_API_SECRET");

    let _ = dotenvy::dotenv();
    
    // Pass Last.fm keys to the compiler so env! can see them
    if let Ok(key) = std::env::var("LASTFM_API_KEY") {
        println!("cargo:rustc-env=LASTFM_API_KEY={}", key);
    }
    if let Ok(secret) = std::env::var("LASTFM_API_SECRET") {
        println!("cargo:rustc-env=LASTFM_API_SECRET={}", secret);
    }

    ensure_sidecar();
    tauri_build::build()
}

/// Tauri refuses to build when a configured `externalBin` file is missing, which would break `cargo check` and
/// `cargo test` for anyone who has not built the addon sidecar. Debug builds get a tiny placeholder (the app ignores
/// it, see `addons/sidecar.rs`); release builds must have the real executable from `npm run build:sidecar`.
fn ensure_sidecar() {
    // Keep in sync with MIN_SIDECAR_BYTES in src/addons/sidecar.rs.
    const MIN_SIDECAR_BYTES: u64 = 1024 * 1024;
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let suffix = if target.contains("windows") { ".exe" } else { "" };
    let path = std::path::Path::new("bin").join(format!("aideo-addons-{target}{suffix}"));
    println!("cargo:rerun-if-changed={}", path.display());
    if std::fs::metadata(&path).is_ok_and(|m| m.len() >= MIN_SIDECAR_BYTES) {
        return;
    }
    if std::env::var("PROFILE").is_ok_and(|profile| profile == "release") {
        panic!(
            "{} is missing or is only a placeholder. Run `npm run build:sidecar` before a release build.",
            path.display()
        );
    }
    std::fs::create_dir_all("bin").expect("create src-tauri/bin");
    std::fs::write(&path, b"AIDEO_SIDECAR_PLACEHOLDER").expect("write sidecar placeholder");
}
