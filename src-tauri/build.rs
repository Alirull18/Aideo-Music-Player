fn main() {
    let _ = dotenvy::dotenv();
    
    // Pass Last.fm keys to the compiler so env! can see them
    if let Ok(key) = std::env::var("LASTFM_API_KEY") {
        println!("cargo:rustc-env=LASTFM_API_KEY={}", key);
    }
    if let Ok(secret) = std::env::var("LASTFM_API_SECRET") {
        println!("cargo:rustc-env=LASTFM_API_SECRET={}", secret);
    }

    tauri_build::build()
}
