//! Local cloud addons (Tidal, Qobuz, Subsonic, Jellyfin) are separate loopback processes, one per provider.
//!
//! Release builds ship them as the bundled `aideo-addons` executable (a Node single-executable app, see
//! `scripts/build-sidecar.mjs`). Debug builds fall back to `node addons-sdk/cloud/server.mjs` from a repository
//! checkout. Release builds never execute scripts from the working directory.
use crate::safe_lock;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const SIDECAR_NAME: &str = "aideo-addons";
/// `build.rs` writes a tiny placeholder when the real sidecar has not been built, so Tauri's `externalBin` check
/// passes for `cargo check`/`cargo test`. Anything smaller than this is that placeholder, never a runnable build.
/// Keep in sync with `MIN_SIDECAR_BYTES` in `build.rs`.
const MIN_SIDECAR_BYTES: u64 = 1024 * 1024;
const STARTUP_POLLS: u32 = 60;
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Launcher {
    Sidecar(PathBuf),
    Node { script: PathBuf },
}

fn sidecar_file_name() -> String {
    format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX)
}

fn is_real_sidecar(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() >= MIN_SIDECAR_BYTES)
}

/// Picks how to start an adapter. The bundled executable (next to the app) always wins; the Node script from a
/// checkout is only considered when `allow_node` is set (debug builds).
pub(crate) fn plan(exe_dir: Option<&Path>, cwd: &Path, allow_node: bool) -> Option<Launcher> {
    if let Some(bundled) = exe_dir.map(|dir| dir.join(sidecar_file_name())).filter(|path| is_real_sidecar(path)) {
        return Some(Launcher::Sidecar(bundled));
    }
    if !allow_node {
        return None;
    }
    [
        cwd.join("addons-sdk").join("cloud").join("server.mjs"),
        cwd.join("..").join("addons-sdk").join("cloud").join("server.mjs"),
    ]
    .into_iter()
    .find(|script| script.is_file())
    .map(|script| Launcher::Node { script })
}

/// Environment the adapter reads. Credentials are never passed here: users sign in through the app.
pub(crate) fn child_env(provider: &str, port: u16, session_file: Option<&Path>) -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("PROVIDER", provider.to_string()),
        ("PORT", port.to_string()),
        ("ALLOW_UNCONFIGURED", "1".to_string()),
    ];
    if let Some(file) = session_file {
        env.push(("SESSION_FILE", file.display().to_string()));
    }
    env
}

fn session_file(provider: &str) -> Option<PathBuf> {
    let file = dirs::data_dir()?.join("Aideo").join("addon-sessions").join(format!("{provider}.json"));
    std::fs::create_dir_all(file.parent()?).ok()?;
    Some(file)
}

fn command(launcher: &Launcher, provider: &str, port: u16, session_file: Option<&Path>) -> Command {
    let mut cmd = match launcher {
        Launcher::Sidecar(exe) => Command::new(exe),
        Launcher::Node { script } => {
            let mut cmd = Command::new("node");
            if let Some(env_file) = script.parent().map(|dir| dir.join(format!("{provider}.env"))).filter(|p| p.is_file()) {
                cmd.arg(format!("--env-file={}", env_file.display()));
            }
            cmd.arg(script);
            cmd
        }
    };
    cmd.envs(child_env(provider, port, session_file))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn children() -> &'static Mutex<HashMap<u16, Child>> {
    static CHILDREN: OnceLock<Mutex<HashMap<u16, Child>>> = OnceLock::new();
    CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn listening(port: u16, timeout: Duration) -> bool {
    std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), timeout).is_ok()
}

/// Starts the adapter for `provider` on `port` unless something already listens there. Blocks briefly while it boots.
pub(crate) fn ensure_running(provider: &str, port: u16) {
    if listening(port, Duration::from_millis(100)) {
        return;
    }
    let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let Some(launcher) = plan(exe_dir.as_deref(), &cwd, cfg!(debug_assertions)) else { return };
    {
        let mut running = safe_lock(children());
        // Forget processes that already exited; a live one that is not listening yet is still starting.
        running.retain(|_, child| matches!(child.try_wait(), Ok(None)));
        if !running.contains_key(&port) {
            match command(&launcher, provider, port, session_file(provider).as_deref()).spawn() {
                Ok(child) => {
                    running.insert(port, child);
                }
                Err(_) => return,
            }
        }
    }
    for _ in 0..STARTUP_POLLS {
        if listening(port, STARTUP_POLL_INTERVAL) {
            break;
        }
        std::thread::sleep(STARTUP_POLL_INTERVAL);
    }
}

/// Stops every adapter this app started. Returns how many processes were running.
pub(crate) fn stop_all() -> usize {
    let drained: Vec<Child> = safe_lock(children()).drain().map(|(_, child)| child).collect();
    let count = drained.len();
    for mut child in drained {
        let _ = child.kill();
        let _ = child.wait();
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aideo-sidecar-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_sized(path: &Path, bytes: u64) {
        let file = std::fs::File::create(path).unwrap();
        file.set_len(bytes).unwrap();
    }

    #[test]
    fn bundled_sidecar_wins_and_placeholder_is_ignored() {
        let app = scratch("app");
        let sidecar = app.join(sidecar_file_name());

        write_sized(&sidecar, 24); // what build.rs writes when the real build is missing
        assert_eq!(plan(Some(&app), &app, false), None, "placeholder must never be launched");

        write_sized(&sidecar, MIN_SIDECAR_BYTES);
        assert_eq!(plan(Some(&app), &app, false), Some(Launcher::Sidecar(sidecar.clone())));
        assert_eq!(plan(Some(&app), &app, true), Some(Launcher::Sidecar(sidecar)), "sidecar beats node in debug builds");
        let _ = std::fs::remove_dir_all(app);
    }

    #[test]
    fn node_script_is_a_debug_only_fallback() {
        let checkout = scratch("checkout");
        let cloud = checkout.join("addons-sdk").join("cloud");
        std::fs::create_dir_all(&cloud).unwrap();
        let script = cloud.join("server.mjs");
        std::fs::write(&script, "").unwrap();

        assert_eq!(plan(None, &checkout, true), Some(Launcher::Node { script: script.clone() }));
        assert_eq!(plan(None, &checkout, false), None, "release builds never run scripts from the working directory");

        // `cargo tauri dev` runs from src-tauri, one level below the checkout root.
        let nested = checkout.join("src-tauri");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(matches!(plan(None, &nested, true), Some(Launcher::Node { .. })));
        let _ = std::fs::remove_dir_all(checkout);
    }

    #[test]
    fn missing_everything_plans_nothing() {
        let empty = scratch("empty");
        assert_eq!(plan(Some(&empty), &empty, true), None);
        assert_eq!(plan(None, &empty, false), None);
        let _ = std::fs::remove_dir_all(empty);
    }

    #[test]
    fn child_env_carries_routing_only_never_credentials() {
        let env = child_env("tidal", 7013, Some(Path::new("sessions/tidal.json")));
        let names: Vec<_> = env.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, ["PROVIDER", "PORT", "ALLOW_UNCONFIGURED", "SESSION_FILE"]);
        assert!(env.contains(&("PROVIDER", "tidal".to_string())));
        assert!(env.contains(&("PORT", "7013".to_string())));
        assert_eq!(child_env("qobuz", 7014, None).len(), 3);
    }

    /// Launches the executable produced by `npm run build:sidecar` exactly as the app does. CI builds it before
    /// `cargo test`; on a machine that has not built it there is nothing to launch, so the test returns early.
    #[test]
    fn built_sidecar_serves_its_featured_manifest() {
        use std::io::{Read, Write};

        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("bin");
        let Some(exe) = std::fs::read_dir(&bin).into_iter().flatten().flatten().map(|e| e.path()).find(|path| {
            path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("aideo-addons-")) && is_real_sidecar(path)
        }) else {
            eprintln!("skipped: run `npm run build:sidecar` to exercise the real executable");
            return;
        };

        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let mut child = command(&Launcher::Sidecar(exe), "subsonic", port, None).spawn().expect("start the sidecar");
        let booted = (0..100).any(|_| {
            std::thread::sleep(Duration::from_millis(100));
            listening(port, Duration::from_millis(100))
        });
        let mut body = String::new();
        if booted {
            let mut socket = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            let request = format!("GET /manifest.json HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            socket.write_all(request.as_bytes()).unwrap();
            socket.read_to_string(&mut body).unwrap();
        }
        let _ = child.kill();
        let _ = child.wait();

        assert!(booted, "the sidecar never started listening on {port}");
        assert!(body.contains("200 OK"), "{body}");
        assert!(body.contains("\"id\":\"org.aideo.subsonic\""), "{body}");
        assert!(body.contains("\"name\":\"Subsonic / Navidrome\""), "{body}");
    }

    #[test]
    fn stop_all_kills_and_forgets_started_adapters() {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("ping");
            cmd.args(["-n", "60", "127.0.0.1"]);
            cmd
        } else {
            let mut cmd = Command::new("sleep");
            cmd.arg("60");
            cmd
        };
        let child = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("spawn a long-running process");
        stop_all(); // start from an empty registry
        safe_lock(children()).insert(1, child);

        assert_eq!(stop_all(), 1);
        assert!(safe_lock(children()).is_empty());
        assert_eq!(stop_all(), 0, "stopping twice is harmless");
    }
}
