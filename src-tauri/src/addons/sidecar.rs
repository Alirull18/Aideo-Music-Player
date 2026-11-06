//! Local cloud addons (Tidal, Qobuz, Subsonic, Jellyfin) are separate loopback processes, one per provider.
//!
//! Release builds ship them as the bundled `aideo-addons` executable (a Node single-executable app, see
//! `scripts/build-sidecar.mjs`). Debug builds fall back to `node addons-sdk/cloud/server.mjs` from a repository
//! checkout. Release builds never execute scripts from the working directory.
//!
//! Two protections cover the fixed loopback ports:
//! * Proof of ownership: the app passes each child a random per-launch secret and, before trusting a port, asks it to
//!   answer a fresh nonce with `HMAC-SHA256(secret, nonce)`. A process that merely grabbed the port (another user, or
//!   something that started first) cannot answer, so credentials typed into the app never reach it.
//! * No orphans: the app keeps each child's stdin pipe open, and the child exits when it closes. If the app crashes or
//!   is killed, the operating system closes the pipe.
use crate::safe_lock;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::io::{Read, Write};
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
const PROOF_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_PROOF_RESPONSE: u64 = 4096;

type HmacSha256 = Hmac<Sha256>;

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

/// Random secret shared only with the processes this app starts, regenerated on every launch.
fn launch_secret() -> &'static str {
    static SECRET: OnceLock<String> = OnceLock::new();
    SECRET.get_or_init(|| hex::encode(rand::random::<[u8; 32]>()))
}

/// Environment the adapter reads. Provider credentials are never passed here: users sign in through the app.
pub(crate) fn child_env(provider: &str, port: u16, session_file: Option<&Path>, secret: &str) -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("PROVIDER", provider.to_string()),
        ("PORT", port.to_string()),
        ("ALLOW_UNCONFIGURED", "1".to_string()),
        ("AIDEO_SIDECAR_SECRET", secret.to_string()),
        ("AIDEO_EXIT_WITH_PARENT", "1".to_string()),
    ];
    if let Some(file) = session_file {
        env.push(("SESSION_FILE", file.display().to_string()));
    }
    env
}

#[cfg_attr(test, allow(dead_code))] // only reached from `ensure_running`, which tests do not call
fn session_file(provider: &str) -> Option<PathBuf> {
    let file = dirs::data_dir()?.join("Aideo").join("addon-sessions").join(format!("{provider}.json"));
    std::fs::create_dir_all(file.parent()?).ok()?;
    Some(file)
}

fn command(launcher: &Launcher, provider: &str, port: u16, session_file: Option<&Path>, secret: &str) -> Command {
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
    cmd.envs(child_env(provider, port, session_file, secret))
        // Piped and kept open by the `Child` handle: the adapter exits when this process dies and the pipe closes.
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn mac_for(secret: &str, nonce: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(nonce.as_bytes());
    mac
}

/// What a genuine sidecar answers for `nonce`. The app only verifies proofs; tests need to produce them.
#[cfg(test)]
fn hmac_hex(secret: &str, nonce: &str) -> String {
    hex::encode(mac_for(secret, nonce).finalize().into_bytes())
}

/// Constant-time check that `proof_hex` is `HMAC-SHA256(secret, nonce)`.
pub(crate) fn proof_is_valid(secret: &str, nonce: &str, proof_hex: &str) -> bool {
    let Ok(proof) = hex::decode(proof_hex) else { return false };
    mac_for(secret, nonce).verify_slice(&proof).is_ok()
}

fn request_proof(port: u16, nonce: &str) -> Option<String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = std::net::TcpStream::connect_timeout(&addr, PROOF_TIMEOUT).ok()?;
    stream.set_read_timeout(Some(PROOF_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(PROOF_TIMEOUT)).ok()?;
    // HTTP/1.0 so the server answers with a plain body; HTTP/1.1 replies without a Content-Length are chunked.
    let request = format!("GET /sidecar-proof?nonce={nonce} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    stream.take(MAX_PROOF_RESPONSE).read_to_string(&mut response).ok()?;
    let (head, body) = response.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(body.trim())
        .ok()?
        .get("proof")?
        .as_str()
        .map(str::to_owned)
}

/// Asks whatever listens on `port` to prove it holds `secret`.
pub(crate) fn listener_holds_secret(port: u16, secret: &str) -> bool {
    let nonce = hex::encode(rand::random::<[u8; 16]>());
    request_proof(port, &nonce).is_some_and(|proof| proof_is_valid(secret, &nonce, &proof))
}

struct Running {
    child: Child,
    proven: bool,
}

fn children() -> &'static Mutex<HashMap<u16, Running>> {
    static CHILDREN: OnceLock<Mutex<HashMap<u16, Running>>> = OnceLock::new();
    CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

fn listening(port: u16, timeout: Duration) -> bool {
    std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), timeout).is_ok()
}

fn foreign_listener_error(provider: &str, port: u16) -> String {
    format!(
        "Port {port} is already in use by another program, so the {provider} addon cannot start. \
         Close that program and try again."
    )
}

/// Starts the adapter for `provider` on `port` and makes sure the process answering there is the one this app
/// started. Returns an error only when something else holds the port or the listener fails the ownership proof;
/// "nothing to start" and "slow to start" stay `Ok` so callers keep their existing fallbacks.
#[cfg_attr(test, allow(dead_code))] // tests drive `ensure_with` directly
pub(crate) fn ensure_running(provider: &str, port: u16) -> Result<(), String> {
    // Debug builds only: let a developer run their own adapter on the featured ports.
    let trust_external = cfg!(debug_assertions) && std::env::var_os("AIDEO_TRUST_EXTERNAL_ADDON_SERVERS").is_some();
    let launcher = || {
        let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        plan(exe_dir.as_deref(), &cwd, cfg!(debug_assertions))
    };
    ensure_with(provider, port, launcher, trust_external, launch_secret())
}

fn ensure_with(
    provider: &str,
    port: u16,
    launcher: impl FnOnce() -> Option<Launcher>,
    trust_external: bool,
    secret: &str,
) -> Result<(), String> {
    let (owned, proven) = {
        let mut running = safe_lock(children());
        // Forget processes that already exited; a live one that is not listening yet is still starting.
        running.retain(|_, entry| matches!(entry.child.try_wait(), Ok(None)));
        running.get(&port).map_or((false, false), |entry| (true, entry.proven))
    };
    let is_listening = listening(port, Duration::from_millis(100));
    if owned && proven && is_listening {
        return Ok(());
    }

    if !is_listening && !owned {
        let Some(launcher) = launcher() else { return Ok(()) };
        match command(&launcher, provider, port, session_file(provider).as_deref(), secret).spawn() {
            Ok(child) => {
                safe_lock(children()).insert(port, Running { child, proven: false });
            }
            Err(_) => return Ok(()),
        }
    }

    for _ in 0..STARTUP_POLLS {
        if listening(port, STARTUP_POLL_INTERVAL) {
            break;
        }
        std::thread::sleep(STARTUP_POLL_INTERVAL);
    }
    if !listening(port, STARTUP_POLL_INTERVAL) {
        return Ok(());
    }

    let owned_now = safe_lock(children()).contains_key(&port);
    if !owned_now {
        return if trust_external { Ok(()) } else { Err(foreign_listener_error(provider, port)) };
    }
    if listener_holds_secret(port, secret) {
        if let Some(entry) = safe_lock(children()).get_mut(&port) {
            entry.proven = true;
        }
        return Ok(());
    }
    // Our child lost the race for the port (or something is impersonating it): stop it and refuse to talk to the port.
    stop_matching(|p| p == port);
    Err(foreign_listener_error(provider, port))
}

/// Stops the adapters whose port satisfies `which`. Returns how many processes were running.
fn stop_matching(which: impl Fn(u16) -> bool) -> usize {
    let mut stopped = Vec::new();
    {
        let mut running = safe_lock(children());
        let ports: Vec<u16> = running.keys().copied().filter(|port| which(*port)).collect();
        for port in ports {
            stopped.extend(running.remove(&port));
        }
    }
    let count = stopped.len();
    for mut entry in stopped {
        let _ = entry.child.kill();
        let _ = entry.child.wait();
    }
    count
}

/// Stops every adapter this app started. Returns how many processes were running.
pub(crate) fn stop_all() -> usize {
    stop_matching(|_| true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

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
    fn child_env_carries_routing_and_the_launch_secret_only() {
        let env = child_env("tidal", 7013, Some(Path::new("sessions/tidal.json")), "s3cret");
        let names: Vec<_> = env.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            ["PROVIDER", "PORT", "ALLOW_UNCONFIGURED", "AIDEO_SIDECAR_SECRET", "AIDEO_EXIT_WITH_PARENT", "SESSION_FILE"]
        );
        assert!(env.contains(&("PROVIDER", "tidal".to_string())));
        assert!(env.contains(&("PORT", "7013".to_string())));
        assert!(env.contains(&("AIDEO_EXIT_WITH_PARENT", "1".to_string())));
        assert_eq!(child_env("qobuz", 7014, None, "s3cret").len(), 5);
    }

    #[test]
    fn launch_secret_is_long_random_and_stable_within_a_launch() {
        let secret = launch_secret();
        assert_eq!(secret.len(), 64);
        assert!(secret.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(secret, launch_secret());
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vector() {
        // RFC 4231 test case 2; the sidecar computes the same value with node:crypto.
        assert_eq!(
            hmac_hex("Jefe", "what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn only_the_right_secret_produces_a_valid_proof() {
        let nonce = "0123456789abcdef0123456789abcdef";
        let good = hmac_hex("right-secret", nonce);
        assert!(proof_is_valid("right-secret", nonce, &good));
        assert!(!proof_is_valid("wrong-secret", nonce, &good));
        assert!(!proof_is_valid("right-secret", "fedcba9876543210fedcba9876543210", &good), "proofs are per nonce");
        for junk in ["", "zz", "not hex", &good[..good.len() - 2], &format!("{good}00")] {
            assert!(!proof_is_valid("right-secret", nonce, junk), "{junk:?}");
        }
    }

    /// Serves exactly one request on a loopback port, answering with whatever `respond` returns for the nonce in the
    /// request (a full HTTP response), and returns the port.
    fn fake_listener(respond: impl Fn(&str) -> String + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let nonce = request.split("nonce=").nth(1).and_then(|rest| rest.split(' ').next()).unwrap_or("").to_string();
                let _ = stream.write_all(respond(&nonce).as_bytes());
            }
        });
        port
    }

    fn json_response(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[test]
    fn a_listener_that_holds_the_secret_is_accepted() {
        let port = fake_listener(|nonce| json_response("200 OK", &format!(r#"{{"proof":"{}"}}"#, hmac_hex("launch", nonce))));
        assert!(listener_holds_secret(port, "launch"));
    }

    #[test]
    fn a_chunked_response_is_not_mistaken_for_a_proof() {
        // Why the request is HTTP/1.0: a chunked body does not parse as JSON, and that failure must be closed.
        let port = fake_listener(|nonce| {
            let body = format!(r#"{{"proof":"{}"}}"#, hmac_hex("launch", nonce));
            format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len())
        });
        assert!(!listener_holds_secret(port, "launch"));
    }

    #[test]
    fn a_listener_that_cannot_prove_the_secret_is_rejected() {
        // Wrong secret, replayed proof, error status, junk body, and a port nobody listens on.
        let wrong = fake_listener(|nonce| json_response("200 OK", &format!(r#"{{"proof":"{}"}}"#, hmac_hex("guess", nonce))));
        assert!(!listener_holds_secret(wrong, "launch"));

        let replay = fake_listener(|_| {
            json_response("200 OK", &format!(r#"{{"proof":"{}"}}"#, hmac_hex("launch", "a-different-earlier-nonce")))
        });
        assert!(!listener_holds_secret(replay, "launch"), "a recorded proof must not work for a fresh nonce");

        let not_found = fake_listener(|_| json_response("404 Not Found", r#"{"error":"Not found"}"#));
        assert!(!listener_holds_secret(not_found, "launch"));

        let junk = fake_listener(|_| "not http at all".to_string());
        assert!(!listener_holds_secret(junk, "launch"));

        let closed = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(!listener_holds_secret(closed, "launch"));
    }

    fn built_sidecar() -> Option<PathBuf> {
        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("bin");
        std::fs::read_dir(&bin).into_iter().flatten().flatten().map(|e| e.path()).find(|path| {
            path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("aideo-addons-")) && is_real_sidecar(path)
        })
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    /// Launches the executable produced by `npm run build:sidecar` exactly as the app does. CI builds it before
    /// `cargo test`; on a machine that has not built it there is nothing to launch, so the test returns early.
    #[test]
    fn built_sidecar_serves_its_manifest_and_proves_it_holds_the_launch_secret() {
        let Some(exe) = built_sidecar() else {
            eprintln!("skipped: run `npm run build:sidecar` to exercise the real executable");
            return;
        };
        let port = free_port();
        let secret = launch_secret();
        let mut child = command(&Launcher::Sidecar(exe), "subsonic", port, None, secret).spawn().expect("start the sidecar");
        let booted = (0..100).any(|_| {
            std::thread::sleep(Duration::from_millis(100));
            listening(port, Duration::from_millis(100))
        });
        let mut body = String::new();
        let (proved, impostor_rejected) = if booted {
            let mut socket = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            let request = format!("GET /manifest.json HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            socket.write_all(request.as_bytes()).unwrap();
            socket.read_to_string(&mut body).unwrap();
            (listener_holds_secret(port, secret), !listener_holds_secret(port, "some-other-launch-secret"))
        } else {
            (false, false)
        };
        let _ = child.kill();
        let _ = child.wait();

        assert!(booted, "the sidecar never started listening on {port}");
        assert!(body.contains("200 OK"), "{body}");
        assert!(body.contains("\"id\":\"org.aideo.subsonic\""), "{body}");
        assert!(body.contains("\"name\":\"Subsonic / Navidrome\""), "{body}");
        assert!(proved, "the real sidecar must answer the ownership proof");
        assert!(impostor_rejected, "a different launch secret must not verify");
    }

    #[test]
    fn built_sidecar_exits_when_the_app_side_pipe_closes() {
        let Some(exe) = built_sidecar() else {
            eprintln!("skipped: run `npm run build:sidecar` to exercise the real executable");
            return;
        };
        let port = free_port();
        let mut child = command(&Launcher::Sidecar(exe), "subsonic", port, None, launch_secret()).spawn().expect("start the sidecar");
        assert!((0..100).any(|_| {
            std::thread::sleep(Duration::from_millis(100));
            listening(port, Duration::from_millis(100))
        }), "the sidecar never started listening");

        drop(child.stdin.take()); // what the OS does to the pipe when the app dies
        let exited = (0..100).any(|_| {
            std::thread::sleep(Duration::from_millis(100));
            matches!(child.try_wait(), Ok(Some(_)))
        });
        if !exited {
            let _ = child.kill();
        }
        let _ = child.wait();
        assert!(exited, "the sidecar outlived its parent pipe");
    }

    #[test]
    fn stopping_kills_and_forgets_only_the_selected_adapters() {
        let spawn_idle = || {
            let mut cmd = if cfg!(windows) {
                let mut cmd = Command::new("ping");
                cmd.args(["-n", "60", "127.0.0.1"]);
                cmd
            } else {
                let mut cmd = Command::new("sleep");
                cmd.arg("60");
                cmd
            };
            cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("spawn a long-running process")
        };
        // Keys that no real port uses, so concurrently running tests are unaffected.
        safe_lock(children()).insert(1, Running { child: spawn_idle(), proven: true });
        safe_lock(children()).insert(2, Running { child: spawn_idle(), proven: true });

        assert_eq!(stop_matching(|port| port == 1), 1);
        assert!(!safe_lock(children()).contains_key(&1));
        assert!(safe_lock(children()).contains_key(&2), "other adapters keep running");
        assert_eq!(stop_matching(|port| port == 1), 0, "stopping twice is harmless");
        assert_eq!(stop_matching(|port| port == 2), 1);
    }

    #[test]
    fn a_port_held_by_something_else_is_refused_unless_a_developer_opts_in() {
        let squatter = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = squatter.local_addr().unwrap().port();

        let refused = ensure_with("tidal", port, || None, false, "launch").unwrap_err();
        assert!(refused.contains("another program") && refused.contains(&port.to_string()), "{refused}");
        assert!(!safe_lock(children()).contains_key(&port), "nothing is registered for a foreign listener");

        assert_eq!(ensure_with("tidal", port, || None, true, "launch"), Ok(()), "dev opt-in trusts it");
    }

    #[test]
    fn nothing_to_start_is_not_an_error() {
        let free = free_port();
        assert_eq!(ensure_with("tidal", free, || None, false, "launch"), Ok(()));
    }

    #[test]
    fn ensure_with_starts_the_built_sidecar_and_proves_it_once() {
        let Some(exe) = built_sidecar() else {
            eprintln!("skipped: run `npm run build:sidecar` to exercise the real executable");
            return;
        };
        let port = free_port();
        let secret = launch_secret();

        assert_eq!(ensure_with("subsonic", port, || Some(Launcher::Sidecar(exe)), false, secret), Ok(()));
        assert!(safe_lock(children()).get(&port).is_some_and(|entry| entry.proven), "started and proven");
        assert!(listener_holds_secret(port, secret));

        // Second call takes the fast path and must not need (or start) another process.
        assert_eq!(ensure_with("subsonic", port, || panic!("no second launch"), false, secret), Ok(()));
        assert_eq!(stop_matching(|p| p == port), 1);
        std::thread::sleep(Duration::from_millis(300)); // let the OS release the port
        assert!(!listening(port, Duration::from_millis(200)), "stopping the adapter frees its port");
    }
}
