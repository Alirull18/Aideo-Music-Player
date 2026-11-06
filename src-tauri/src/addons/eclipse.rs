//! HTTP client for Eclipse-compatible addons (https://eclipsemusic.app/docs).
//! Everything here treats the addon and its responses as untrusted input.
use crate::sources::{RecordingEvidence, ResolvedStream, SourceQuality};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::sync::OnceLock;
use std::time::Duration;
use url::{Host, Url};

const MAX_BODY: usize = 2 * 1024 * 1024;
const MAX_TRACKS: usize = 200;
pub(crate) const MANIFEST_BUDGET: Duration = Duration::from_secs(5);
pub(crate) const SEARCH_BUDGET: Duration = Duration::from_secs(5);
pub(crate) const STREAM_BUDGET: Duration = Duration::from_secs(3);
/// Installing is a one-off, user-initiated step; free-tier hosts can take tens of seconds to wake.
pub(crate) const INSTALL_BUDGET: Duration = Duration::from_secs(30);

pub(crate) fn build_client(no_proxy: bool) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .user_agent("AideoMusicPlayer-Addon/1");
    if no_proxy {
        b = b.no_proxy();
    }
    b.build().expect("addon http client")
}

pub(crate) fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| build_client(false))
}

fn v4_private(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback() || ip.is_private() || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64/10 CGNAT, Tailscale
}

fn v4_blocked(ip: Ipv4Addr) -> bool {
    ip.is_unspecified() || ip.is_link_local() || ip.is_multicast() || ip == Ipv4Addr::BROADCAST
}

/// True for localhost / loopback / RFC1918 / CGNAT / ULA hosts (domains are only matched by name).
pub(crate) fn is_private_host(u: &Url) -> bool {
    match u.host() {
        Some(Host::Domain(d)) => {
            let d = d.trim_end_matches('.');
            d == "localhost" || d.ends_with(".localhost")
        }
        Some(Host::Ipv4(ip)) => v4_private(ip),
        Some(Host::Ipv6(ip)) => match ip.to_ipv4_mapped() {
            Some(v4) => v4_private(v4),
            None => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
        },
        None => false,
    }
}

/// Addresses that are never valid targets (unspecified, link-local incl. cloud metadata, multicast).
pub(crate) fn is_blocked_host(u: &Url) -> bool {
    match u.host() {
        Some(Host::Ipv4(ip)) => v4_blocked(ip),
        Some(Host::Ipv6(ip)) => match ip.to_ipv4_mapped() {
            Some(v4) => v4_blocked(v4),
            None => ip.is_unspecified() || ip.is_multicast() || (ip.segments()[0] & 0xffc0) == 0xfe80,
        },
        Some(Host::Domain(_)) => false,
        None => true,
    }
}

fn ip_denied(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4_private(v4) || v4_blocked(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4_private(v4) || v4_blocked(v4),
            None => v6.is_loopback() || v6.is_unspecified() || v6.is_multicast()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
        },
    }
}

fn system_lookup(host: &str, port: u16) -> std::io::Result<Vec<IpAddr>> {
    Ok((host, port).to_socket_addrs()?.map(|a| a.ip()).collect())
}

/// Redirect policy for the stream downloader: follow public http(s) hops only, so a public addon
/// can't bounce the player into the LAN or a metadata endpoint after `check_url` approved the first URL.
/// Domain hops are resolved and refused if any address is private/blocked (fails closed on lookup error).
pub(crate) fn redirect_target_allowed(u: &Url) -> bool {
    redirect_target_allowed_with(u, system_lookup)
}

fn redirect_target_allowed_with(u: &Url, lookup: impl Fn(&str, u16) -> std::io::Result<Vec<IpAddr>>) -> bool {
    if !(matches!(u.scheme(), "http" | "https") && u.username().is_empty() && !is_blocked_host(u) && !is_private_host(u)) {
        return false;
    }
    match u.host() {
        Some(Host::Domain(d)) => match lookup(d, u.port_or_known_default().unwrap_or(443)) {
            Ok(addrs) => !addrs.is_empty() && !addrs.into_iter().any(ip_denied),
            Err(_) => false,
        },
        _ => true,
    }
}

/// Scheme/host policy for user-supplied URLs. ponytail: the initial URL is checked by literal IP/name only
/// and redirect hops are resolved once before connecting, so DNS rebinding between check and connect is not
/// covered; pin results via `ClientBuilder::resolve_to_addrs` if addons ever run unattended.
pub(crate) fn check_url(u: &Url, allow_private: bool) -> Result<(), String> {
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Addon URL must be http(s)".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("Addon URL must not contain credentials".into());
    }
    if u.host().is_none() {
        return Err("Addon URL has no host".into());
    }
    if is_blocked_host(u) {
        return Err("Addon host address is not allowed".into());
    }
    let private = is_private_host(u);
    if private && !allow_private {
        return Err("Addon returned a private-network URL".into());
    }
    if u.scheme() == "http" && !private {
        return Err("Addon URL must use https (http is only allowed on the local network)".into());
    }
    Ok(())
}

/// `https://host/token/manifest.json?x=1` -> `https://host/token?x=1` (the token lives in the URL).
pub(crate) fn base_from_manifest_url(raw: &str) -> Result<Url, String> {
    let mut u = Url::parse(raw.trim()).map_err(|_| "Invalid addon URL".to_string())?;
    check_url(&u, true)?;
    u.set_fragment(None);
    let bad = || "Invalid addon URL".to_string();
    let mut segs = u.path_segments_mut().map_err(|_| bad())?;
    segs.pop_if_empty();
    drop(segs);
    if u.path_segments().and_then(|mut s| s.next_back()) == Some("manifest.json") {
        u.path_segments_mut().map_err(|_| bad())?.pop();
    }
    Ok(u)
}

fn endpoint(base: &Url, segs: &[&str]) -> Url {
    let mut u = base.clone();
    if let Ok(mut s) = u.path_segments_mut() {
        s.pop_if_empty();
        s.extend(segs);
    }
    u
}

pub(crate) async fn get_json<T: serde::de::DeserializeOwned>(c: &reqwest::Client, u: Url, budget: Duration) -> Result<T, String> {
    let fut = async {
        // The per-request timeout replaces the client's 6s default so a longer budget can take effect.
        let mut res = c.get(u).timeout(budget).send().await.map_err(|e| e.without_url().to_string())?;
        if !res.status().is_success() {
            return Err(format!("Addon returned HTTP {}", res.status().as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| e.without_url().to_string())? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err("Addon response too large".into());
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| "Addon returned invalid JSON".to_string())
    };
    tokio::time::timeout(budget, fut).await.map_err(|_| "Addon timed out".to_string())?
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AddonAuthField {
    pub key: String,
    pub label: String,
    #[serde(default, rename = "type")]
    pub field_type: Option<String>,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AddonAuthSpec {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, rename = "helpText")]
    pub help_text: Option<String>,
    #[serde(default)]
    pub fields: Vec<AddonAuthField>,
    /// Host capability, never taken from the addon: set by `addons::info` for ids the app can drive.
    #[serde(default, skip_deserializing, rename = "browserLogin")]
    pub browser_login: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
    #[serde(default)]
    pub auth: Option<AddonAuthSpec>,
}

fn clean(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}

fn http_url(s: &str) -> bool {
    s.len() <= 2048 && Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

/// Featured local cloud addons. `addons-sdk/cloud/featured.json` is shared with the Node adapter
/// and the frontend catalog, so ids, ports and auth forms are defined once.
#[derive(Deserialize)]
pub(crate) struct Featured {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub port: u16,
    pub description: String,
    pub resources: Vec<String>,
    pub auth: AddonAuthSpec,
}

pub(crate) fn featured() -> &'static [Featured] {
    static FEATURED: OnceLock<Vec<Featured>> = OnceLock::new();
    FEATURED.get_or_init(|| {
        serde_json::from_str(include_str!("../../../addons-sdk/cloud/featured.json")).expect("valid featured.json")
    })
}

fn featured_for_base(base: &Url) -> Option<&'static Featured> {
    if !matches!(base.host_str(), Some("127.0.0.1") | Some("localhost")) {
        return None;
    }
    let port = base.port()?;
    featured().iter().find(|entry| entry.port == port)
}

pub(crate) fn builtin_featured_manifest(base: &Url) -> Option<Manifest> {
    let entry = featured_for_base(base)?;
    Some(Manifest {
        id: entry.id.clone(),
        name: entry.name.clone(),
        version: "1.0.0".into(),
        description: Some(entry.description.clone()),
        icon: None,
        resources: entry.resources.clone(),
        content_type: Some("music".into()),
        auth: Some(entry.auth.clone()),
    })
}

/// Development convenience only: starts `addons-sdk/cloud/server.mjs` with Node when the app runs
/// from a repository checkout. Release builds never execute scripts from the working directory.
pub(crate) fn ensure_local_cloud_server(base: &Url) {
    #[cfg(any(test, not(debug_assertions)))]
    {
        let _ = base;
        return;
    }
    #[cfg(all(not(test), debug_assertions))]
    {
        if !matches!(base.host_str(), Some("127.0.0.1") | Some("localhost")) {
            return;
        }
        let Some(entry) = featured_for_base(base) else { return };
        let (provider, port) = (entry.provider.as_str(), entry.port);
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
            return;
        }
        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let candidates = [
            cwd.join("addons-sdk").join("cloud").join("server.mjs"),
            cwd.join("..").join("addons-sdk").join("cloud").join("server.mjs"),
        ];
        let Some(server_mjs) = candidates.into_iter().find(|p| p.is_file()) else {
            return;
        };
        let mut cmd = std::process::Command::new("node");
        if let Some(dir) = server_mjs.parent() {
            let env_file = dir.join(format!("{provider}.env"));
            if env_file.is_file() {
                cmd.arg(format!("--env-file={}", env_file.display()));
            }
        }
        if let Some(session_file) = dirs::data_dir().map(|d| d.join("Aideo").join("addon-sessions").join(format!("{provider}.json"))) {
            if let Some(parent) = session_file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            cmd.env("SESSION_FILE", session_file);
        }
        cmd.arg(&server_mjs)
            .env("PROVIDER", provider)
            .env("PORT", port.to_string())
            .env("ALLOW_UNCONFIGURED", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        if cmd.spawn().is_ok() {
            for _ in 0..20 {
                if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(50)).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

pub(crate) async fn fetch_manifest(c: &reqwest::Client, base: &Url) -> Result<Manifest, String> {
    ensure_local_cloud_server(base);
    let m: Manifest = match get_json(c, endpoint(base, &["manifest.json"]), INSTALL_BUDGET).await {
        Ok(m) => m,
        Err(e) => {
            if let Some(fallback) = builtin_featured_manifest(base) {
                return Ok(fallback);
            }
            return Err(if e == "Addon timed out" {
                "The addon did not respond. Hosts on free plans can take up to a minute to wake up, so try again shortly.".into()
            } else {
                e
            });
        }
    };
    if !super::valid_addon_id(&m.id) || !clean(&m.name, 128) || !clean(&m.version, 64) {
        return Err("Addon manifest is invalid".into());
    }
    let has = |r: &str| m.resources.iter().any(|x| x == r);
    let music = has("search") && has("stream");
    // Lyrics/translate are an Aideo extension on top of the Eclipse protocol.
    if !music && !has("lyrics") && !has("translate") {
        return Err("Addon must provide search+stream, lyrics, or translate".into());
    }
    Ok(Manifest { icon: m.icon.filter(|i| http_url(i)), ..m })
}

#[derive(Serialize, Debug)]
pub struct AddonTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Option<u32>,
    pub cover_url: Option<String>,
    pub recording_evidence: RecordingEvidence,
    pub catalog_quality: SourceQuality,
}

#[derive(Deserialize)]
struct RawTrack {
    id: serde_json::Value,
    title: String,
    artist: String,
    #[serde(default)]
    album: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default, rename = "artworkURL")]
    artwork_url: Option<String>,
    #[serde(default)]
    isrc: Option<String>,
    #[serde(default)]
    upc: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    explicit: Option<bool>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    lossless: Option<bool>,
    #[serde(default, rename = "sampleRate")]
    sample_rate: Option<f64>,
    #[serde(default, rename = "bitDepth")]
    bit_depth: Option<u32>,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    tracks: Vec<serde_json::Value>,
}

fn lossless_format(f: &str) -> bool {
    matches!(f.to_ascii_lowercase().as_str(), "flac" | "alac" | "wav")
}

fn non_empty(s: &str, max: usize) -> Option<String> {
    let trimmed = s.trim();
    clean(trimmed, max).then(|| trimmed.to_string())
}

pub(crate) async fn search(c: &reqwest::Client, addon_id: &str, base: &Url, q: &str) -> Result<Vec<AddonTrack>, String> {
    ensure_local_cloud_server(base);
    let mut u = endpoint(base, &["search"]);
    u.query_pairs_mut().append_pair("q", q);
    let res: SearchResponse = get_json(c, u, SEARCH_BUDGET).await?;
    Ok(parse_tracks(addon_id, res.tracks))
}

fn parse_tracks(addon_id: &str, tracks: Vec<serde_json::Value>) -> Vec<AddonTrack> {
    // One malformed item must not discard the batch.
    tracks
        .into_iter()
        .take(MAX_TRACKS)
        .filter_map(|v| {
            let t: RawTrack = serde_json::from_value(v).ok()?;
            let tid = match &t.id {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                _ => return None,
            };
            if !clean(&tid, 512) || !clean(&t.title, 512) {
                return None;
            }
            let codec = t
                .codec
                .as_deref()
                .and_then(|s| non_empty(s, 64))
                .or_else(|| t.format.as_deref().and_then(|s| non_empty(s, 64)));
            let lossless = t.lossless.or_else(|| codec.as_deref().map(lossless_format));
            let sample_rate = t.sample_rate.filter(|r| r.is_finite() && *r > 0.0);
            let bit_depth = t.bit_depth.filter(|&b| b > 0);
            Some(AddonTrack {
                id: format!("{addon_id}:{tid}"),
                title: t.title,
                artist: t.artist,
                album: t.album.unwrap_or_default(),
                duration: t.duration.filter(|d| d.is_finite() && *d >= 0.0).map(|d| d as u32),
                cover_url: t.artwork_url.filter(|a| http_url(a)),
                recording_evidence: RecordingEvidence {
                    isrc: t.isrc.as_deref().and_then(|i| non_empty(i, 32)),
                    upc: t.upc.as_deref().and_then(|u| non_empty(u, 32)),
                    version: t.version.as_deref().and_then(|v| non_empty(v, 128)),
                    explicit: t.explicit,
                },
                catalog_quality: SourceQuality {
                    lossless,
                    sample_rate,
                    bit_depth,
                    codec,
                },
            })
        })
        .collect()
}

/// Album/artist detail pages use the same `{tracks:[...]}` shape as search.
pub(crate) async fn catalog(c: &reqwest::Client, addon_id: &str, base: &Url, kind: &str, id: &str) -> Result<Vec<AddonTrack>, String> {
    if !matches!(kind, "album" | "artist") || !clean(id, 512) {
        return Err("Invalid addon catalog request".into());
    }
    let res: SearchResponse = get_json(c, endpoint(base, &[kind, id]), SEARCH_BUDGET).await?;
    Ok(parse_tracks(addon_id, res.tracks))
}

/// Aideo extension: `/lyrics?q=` -> `{lyrics:[{syncedLyrics,plainLyrics,source,..}]}`.
pub(crate) async fn lyrics(
    c: &reqwest::Client,
    base: &Url,
    q: &str,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<f64>,
) -> Result<Vec<serde_json::Value>, String> {
    #[derive(Deserialize)]
    struct R { #[serde(default)] lyrics: Vec<serde_json::Value> }
    let mut u = endpoint(base, &["lyrics"]);
    {
        let mut qp = u.query_pairs_mut();
        qp.append_pair("q", q);
        for (k, v) in [("title", title), ("artist", artist), ("album", album)] {
            if let Some(s) = v.map(str::trim).filter(|s| !s.is_empty()) {
                qp.append_pair(k, s);
            }
        }
        if let Some(d) = duration.filter(|d| d.is_finite() && *d > 0.0) {
            qp.append_pair("duration", &d.to_string());
        }
    }
    let r: R = get_json(c, u, SEARCH_BUDGET).await?;
    Ok(r.lyrics.into_iter().take(10).collect())
}

/// Aideo extension: `/translate?q=` -> `{translation:"..."}`.
pub(crate) async fn translate(c: &reqwest::Client, base: &Url, text: &str) -> Result<String, String> {
    #[derive(Deserialize)]
    struct R { translation: String }
    let mut u = endpoint(base, &["translate"]);
    u.query_pairs_mut().append_pair("q", text);
    let r: R = get_json(c, u, SEARCH_BUDGET).await?;
    if r.translation.len() > 8192 { return Err("Addon response too large".into()); }
    Ok(r.translation)
}

#[derive(Deserialize)]
struct RawStream {
    url: String,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    manifest: Option<String>,
    #[serde(default)]
    encrypted: Option<bool>,
    #[serde(default, rename = "sampleRate")]
    sample_rate: Option<f64>,
    #[serde(default, rename = "bitDepth")]
    bit_depth: Option<u32>,
}

pub(crate) async fn resolve(
    c: &reqwest::Client,
    base: &Url,
    track_id: &str,
    requested_quality: Option<crate::sources::StreamingQuality>,
) -> Result<ResolvedStream, String> {
    ensure_local_cloud_server(base);
    let mut req_url = endpoint(base, &["stream", track_id]);
    if let Some(q) = requested_quality {
        let q_str = match q {
            crate::sources::StreamingQuality::BestAvailable => "best_available",
            crate::sources::StreamingQuality::StandardLossless => "standard_lossless",
            crate::sources::StreamingQuality::DataSaver => "data_saver",
        };
        req_url.query_pairs_mut().append_pair("quality", q_str);
    }
    let s: RawStream = get_json(c, req_url, STREAM_BUDGET).await?;
    if s.encrypted == Some(true) || s.manifest.as_deref() == Some("dash") {
        return Err("Addon stream type is not supported".into());
    }
    let url = Url::parse(&s.url).map_err(|_| "Addon returned an invalid stream URL".to_string())?;
    check_url(&url, is_private_host(base))?;
    // Addon URLs must not be routed into the YouTube downloader by a lookalike host/query string.
    if crate::player::is_youtube_url_or_id(url.as_str()) {
        return Err("Addon returned a disallowed stream URL".into());
    }
    let codec = s.codec.or(s.format);
    Ok(ResolvedStream {
        url: url.into(),
        quality: SourceQuality {
            lossless: Some(s.bit_depth.is_some() || codec.as_deref().is_some_and(lossless_format)),
            sample_rate: s.sample_rate,
            bit_depth: s.bit_depth,
            codec,
        },
    })
}

async fn send_auth_json(req: reqwest::RequestBuilder, budget: Duration) -> Result<serde_json::Value, String> {
    let fut = async {
        let mut res = req.send().await.map_err(|e| e.without_url().to_string())?;
        let status = res.status();
        let mut body = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| e.without_url().to_string())? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err("Addon response too large".into());
            }
            body.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                if let Some(err) = val.get("error").and_then(|e| e.as_str()).filter(|s| !s.trim().is_empty()) {
                    return Err(err.to_string());
                }
            }
            return Err(format!("Addon auth HTTP {}", status.as_u16()));
        }
        serde_json::from_slice(&body).map_err(|_| "Addon returned invalid JSON".to_string())
    };
    tokio::time::timeout(budget, fut).await.map_err(|_| "Addon timed out".to_string())?
}

pub(crate) async fn auth_status(c: &reqwest::Client, base: &Url) -> Result<serde_json::Value, String> {
    ensure_local_cloud_server(base);
    send_auth_json(c.get(endpoint(base, &["auth", "status"])), MANIFEST_BUDGET).await
}

pub(crate) async fn auth_start_device(c: &reqwest::Client, base: &Url) -> Result<serde_json::Value, String> {
    ensure_local_cloud_server(base);
    send_auth_json(c.post(endpoint(base, &["auth", "device"])), MANIFEST_BUDGET).await
}

pub(crate) async fn auth_poll_device(c: &reqwest::Client, base: &Url) -> Result<serde_json::Value, String> {
    ensure_local_cloud_server(base);
    send_auth_json(c.post(endpoint(base, &["auth", "poll"])), MANIFEST_BUDGET).await
}

pub(crate) async fn auth_login(
    c: &reqwest::Client,
    base: &Url,
    credentials: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_local_cloud_server(base);
    let req = c
        .post(endpoint(base, &["auth", "login"]))
        .json(&serde_json::json!({ "credentials": credentials }));
    send_auth_json(req, MANIFEST_BUDGET).await
}

pub(crate) async fn auth_logout(c: &reqwest::Client, base: &Url) -> Result<serde_json::Value, String> {
    ensure_local_cloud_server(base);
    send_auth_json(c.post(endpoint(base, &["auth", "logout"])), MANIFEST_BUDGET).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn mock_server() -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { return };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                    if path.starts_with("/slow/") {
                        tokio::time::sleep(Duration::from_millis(6500)).await;
                    }
                    let body = match path.as_str() {
                        "/tok/manifest.json" | "/slow/manifest.json" => r#"{"id":"com.test.mock","name":"Mock","version":"1.0.0","description":"Mock addon","resources":["search","stream"],"icon":"javascript:alert(1)","auth":{"type":"credentials","label":"Login","helpText":"Enter key","fields":[{"key":"apiKey","label":"API Key","type":"password","required":true}]}}"#.to_string(),
                        "/tok/search?q=hello+world" => r#"{"tracks":[{"id":7,"title":"Song","artist":"A","artworkURL":"https://x/y.jpg","isrc":"USRC12345678","upc":"001234567890","version":"Remastered","explicit":true,"format":"flac","sampleRate":96000,"bitDepth":24,"duration":240.7},{"id":"bad"}]}"#.to_string(),
                        "/tok/stream/track%201" | "/tok/stream/track%201?quality=best_available" => r#"{"url":"https://cdn.example/a.flac","codec":"flac","sampleRate":96000,"bitDepth":24}"#.to_string(),
                        "/tok/stream/leak" => r#"{"url":"http://10.0.0.5/a.flac"}"#.to_string(),
                        "/tok/lyrics?q=Song" | "/tok/lyrics?q=Song&title=Song&artist=A&album=Alb&duration=240.5" => r#"{"lyrics":[{"syncedLyrics":"[00:01.00]Line","source":"Mock"}]}"#.to_string(),
                        "/tok/translate?q=Line" => r#"{"translation":"Translated"}"#.to_string(),
                        "/tok/album/7" | "/tok/artist/7" => r#"{"tracks":[{"id":7,"title":"Song","artist":"A"}]}"#.to_string(),
                        "/tok/auth/status" => r#"{"ok":true,"authenticated":true,"provider":"mock"}"#.to_string(),
                        "/tok/auth/login" => r#"{"ok":true,"authenticated":true}"#.to_string(),
                        "/tok/auth/logout" => r#"{"ok":true,"authenticated":false}"#.to_string(),
                        "/tok/big" => format!("\"{}\"", "a".repeat(3 * 1024 * 1024)),
                        _ => String::new(),
                    };
                    let head = if body.is_empty() { "HTTP/1.1 404 Not Found" } else { "HTTP/1.1 200 OK" };
                    let _ = s
                        .write_all(format!("{head}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes())
                        .await;
                    let _ = s.write_all(body.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        format!("http://127.0.0.1:{}/tok/manifest.json", addr.port())
    }

    #[tokio::test]
    async fn install_waits_for_a_sleeping_host_beyond_the_client_default() {
        let c = build_client(true);
        let tok = mock_server().await;
        let slow = Url::parse(&tok.replace("/tok/", "/slow/")).unwrap();
        let base = base_from_manifest_url(slow.as_str()).unwrap();
        let started = std::time::Instant::now();
        let m = fetch_manifest(&c, &base).await.expect("a 6.5s manifest must still install");
        assert_eq!(m.id, "com.test.mock");
        assert!(started.elapsed() > Duration::from_secs(6));
    }

    #[tokio::test]
    async fn test_eclipse_addon_search_and_stream() {
        let c = build_client(true);
        let base = base_from_manifest_url(&mock_server().await).unwrap();
        assert!(base.path().ends_with("/tok"), "manifest.json stripped, token kept: {base}");

        let m = fetch_manifest(&c, &base).await.unwrap();
        assert_eq!(m.id, "com.test.mock");
        assert_eq!(m.description.as_deref(), Some("Mock addon"));
        assert_eq!(m.icon, None, "non-http icon dropped");
        let auth = m.auth.expect("manifest auth spec");
        assert_eq!(auth.auth_type, "credentials");
        assert_eq!(auth.label.as_deref(), Some("Login"));
        assert_eq!(auth.help_text.as_deref(), Some("Enter key"));
        assert_eq!(auth.fields.len(), 1);
        assert_eq!(auth.fields[0].key, "apiKey");
        assert_eq!(auth.fields[0].required, Some(true));

        let tracks = search(&c, &m.id, &base, "hello world").await.unwrap();
        assert_eq!(tracks.len(), 1, "malformed item skipped, not fatal");
        assert_eq!(tracks[0].id, "com.test.mock:7");
        assert_eq!(tracks[0].duration, Some(240));
        assert_eq!(tracks[0].cover_url.as_deref(), Some("https://x/y.jpg"));
        assert_eq!(tracks[0].recording_evidence.isrc.as_deref(), Some("USRC12345678"));
        assert_eq!(tracks[0].recording_evidence.upc.as_deref(), Some("001234567890"));
        assert_eq!(tracks[0].recording_evidence.version.as_deref(), Some("Remastered"));
        assert_eq!(tracks[0].recording_evidence.explicit, Some(true));
        assert_eq!(tracks[0].catalog_quality.lossless, Some(true));
        assert_eq!(tracks[0].catalog_quality.sample_rate, Some(96000.0));
        assert_eq!(tracks[0].catalog_quality.bit_depth, Some(24));
        assert_eq!(tracks[0].catalog_quality.codec.as_deref(), Some("flac"));

        let s = resolve(&c, &base, "track 1", Some(crate::sources::StreamingQuality::BestAvailable)).await.unwrap();
        assert_eq!(s.url, "https://cdn.example/a.flac");
        assert_eq!(s.quality.lossless, Some(true));
        assert_eq!((s.quality.sample_rate, s.quality.bit_depth), (Some(96000.0), Some(24)));

        // A local addon may hand back LAN stream URLs; error text must not echo the token URL.
        assert!(resolve(&c, &base, "leak", None).await.is_ok());
        let err = resolve(&c, &base, "missing", None).await.unwrap_err();
        assert!(!err.contains("tok"), "error leaked URL: {err}");

        let big = get_json::<serde_json::Value>(&c, endpoint(&base, &["big"]), Duration::from_secs(5)).await;
        assert!(big.is_err(), "3 MiB body must exceed the cap");
    }

    #[tokio::test]
    async fn extension_resources_and_catalog_routes() {
        let c = build_client(true);
        let base = base_from_manifest_url(&mock_server().await).unwrap();
        assert_eq!(lyrics(&c, &base, "Song", None, None, None, None).await.unwrap()[0]["source"], "Mock");
        assert_eq!(
            lyrics(&c, &base, "Song", Some("Song"), Some("A"), Some("Alb"), Some(240.5)).await.unwrap()[0]["source"],
            "Mock"
        );
        assert_eq!(translate(&c, &base, "Line").await.unwrap(), "Translated");
        for resource in ["album", "artist"] {
            assert_eq!(catalog(&c, "com.test.mock", &base, resource, "7").await.unwrap()[0].id, "com.test.mock:7");
        }
        assert_eq!(auth_status(&c, &base).await.unwrap()["authenticated"], true);
        assert_eq!(
            auth_login(&c, &base, serde_json::json!({"apiKey": "secret"})).await.unwrap()["authenticated"],
            true
        );
        assert_eq!(auth_logout(&c, &base).await.unwrap()["authenticated"], false);
    }

    #[test]
    fn test_check_url_policy() {
        let ok = |s: &str, p: bool| check_url(&Url::parse(s).unwrap(), p).is_ok();
        assert!(ok("https://addon.example/x", false));
        assert!(ok("http://127.0.0.1:3000/", true));
        assert!(ok("http://192.168.1.5/", true));
        assert!(ok("http://localhost:3000/", true));
        assert!(!ok("ftp://example.com/", false));
        assert!(!ok("http://example.com/", false));
        assert!(!ok("http://169.254.169.254/", true));
        assert!(!ok("http://0.0.0.0/", true));
        assert!(!ok("https://u:p@example.com/", false));
        assert!(!ok("http://192.168.1.5/", false), "public addon may not point into the LAN");
        assert!(!ok("http://[fe80::1]/", true));
        assert!(!ok("https://[::ffff:10.0.0.1]/", false), "v4-mapped private is private");
        assert!(!ok("https://[::ffff:169.254.169.254]/", true), "v4-mapped link-local is blocked");
        assert!(!ok("https://localhost./", false), "trailing-dot localhost is private");
        assert!(!ok("https://100.64.1.1/", false), "CGNAT is private");
        let public = |_: &str, _: u16| Ok(vec!["93.184.216.34".parse::<IpAddr>().unwrap()]);
        assert!(redirect_target_allowed_with(&Url::parse("https://cdn.example/a").unwrap(), public));
        assert!(!redirect_target_allowed(&Url::parse("http://192.168.1.1/x").unwrap()));
        assert!(!redirect_target_allowed(&Url::parse("http://169.254.169.254/").unwrap()));
        assert!(!redirect_target_allowed(&Url::parse("file:///etc/passwd").unwrap()));
        assert!(base_from_manifest_url("https://example.com/manifest.json").is_ok());
    }

    #[test]
    fn redirect_hostnames_resolving_to_internal_addresses_are_refused() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let hop = Url::parse("http://innocent.example/stream").unwrap();
        for internal in ["127.0.0.1", "192.168.1.10", "10.0.0.5", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"] {
            let a = ip(internal);
            assert!(!redirect_target_allowed_with(&hop, move |_, _| Ok(vec![a])), "{internal} must be refused");
        }
        // one internal answer among public ones is still refused
        let mixed = vec![ip("93.184.216.34"), ip("192.168.1.10")];
        assert!(!redirect_target_allowed_with(&hop, move |_, _| Ok(mixed.clone())));
        // lookup failure / empty answer fails closed
        assert!(!redirect_target_allowed_with(&hop, |_, _| Err(std::io::Error::other("nxdomain"))));
        assert!(!redirect_target_allowed_with(&hop, |_, _| Ok(vec![])));
        // public answer is followed
        assert!(redirect_target_allowed_with(&hop, |_, _| Ok(vec!["93.184.216.34".parse().unwrap()])));
    }

    #[test]
    fn featured_manifests_come_from_the_shared_catalog() {
        let catalog = featured();
        assert_eq!(catalog.len(), 4);
        assert_eq!(catalog.iter().map(|f| f.port).collect::<std::collections::HashSet<_>>().len(), 4);
        for (port, expected_id, expected_auth_type) in [
            (7011, "org.aideo.subsonic", "credentials"),
            (7012, "org.aideo.jellyfin", "credentials"),
            (7013, "org.aideo.tidal", "device_code"),
            (7014, "org.aideo.qobuz", "credentials"),
        ] {
            let u = Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
            let m = builtin_featured_manifest(&u).expect("featured manifest");
            assert_eq!(m.id, expected_id);
            assert!(super::super::valid_addon_id(&m.id));
            assert!(m.description.is_some());
            assert_eq!(m.resources, vec!["search", "stream"]);
            let auth = m.auth.expect("auth spec");
            assert_eq!(auth.auth_type, expected_auth_type);
            assert!(!auth.fields.is_empty());
            assert!(!auth.browser_login, "browser login is a host capability, not part of the catalog");
        }
        assert!(builtin_featured_manifest(&Url::parse("http://127.0.0.1:9999").unwrap()).is_none());
        assert!(builtin_featured_manifest(&Url::parse("https://example.com:7011").unwrap()).is_none());
    }

    #[test]
    fn addon_supplied_manifest_cannot_enable_browser_login() {
        let m: Manifest = serde_json::from_str(
            r#"{"id":"com.evil.qobuz","name":"x","version":"1","resources":["search","stream"],
                "auth":{"type":"credentials","browserLogin":true}}"#,
        ).unwrap();
        assert!(!m.auth.unwrap().browser_login);
    }
}
