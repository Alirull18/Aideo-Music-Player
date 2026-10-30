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
        let mut res = c.get(u).send().await.map_err(|e| e.without_url().to_string())?;
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

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
}

fn clean(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}

fn http_url(s: &str) -> bool {
    s.len() <= 2048 && Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

pub(crate) async fn fetch_manifest(c: &reqwest::Client, base: &Url) -> Result<Manifest, String> {
    let m: Manifest = get_json(c, endpoint(base, &["manifest.json"]), MANIFEST_BUDGET).await?;
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
    format: Option<String>,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    tracks: Vec<serde_json::Value>,
}

fn lossless_format(f: &str) -> bool {
    matches!(f.to_ascii_lowercase().as_str(), "flac" | "alac" | "wav")
}

pub(crate) async fn search(c: &reqwest::Client, addon_id: &str, base: &Url, q: &str) -> Result<Vec<AddonTrack>, String> {
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
            Some(AddonTrack {
                id: format!("{addon_id}:{tid}"),
                title: t.title,
                artist: t.artist,
                album: t.album.unwrap_or_default(),
                duration: t.duration.filter(|d| d.is_finite() && *d >= 0.0).map(|d| d as u32),
                cover_url: t.artwork_url.filter(|a| http_url(a)),
                recording_evidence: RecordingEvidence { isrc: t.isrc.filter(|i| i.len() <= 32), ..Default::default() },
                catalog_quality: SourceQuality { lossless: t.format.as_deref().map(lossless_format), ..Default::default() },
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
pub(crate) async fn lyrics(c: &reqwest::Client, base: &Url, q: &str) -> Result<Vec<serde_json::Value>, String> {
    #[derive(Deserialize)]
    struct R { #[serde(default)] lyrics: Vec<serde_json::Value> }
    let mut u = endpoint(base, &["lyrics"]);
    u.query_pairs_mut().append_pair("q", q);
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

pub(crate) async fn resolve(c: &reqwest::Client, base: &Url, track_id: &str) -> Result<ResolvedStream, String> {
    let s: RawStream = get_json(c, endpoint(base, &["stream", track_id]), STREAM_BUDGET).await?;
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
                    let body = match path.as_str() {
                        "/tok/manifest.json" => r#"{"id":"com.test.mock","name":"Mock","version":"1.0.0","resources":["search","stream"],"icon":"javascript:alert(1)"}"#.to_string(),
                        "/tok/search?q=hello+world" => r#"{"tracks":[{"id":7,"title":"Song","artist":"A","artworkURL":"https://x/y.jpg","isrc":"USRC12345678","format":"flac","duration":240.7},{"id":"bad"}]}"#.to_string(),
                        "/tok/stream/track%201" => r#"{"url":"https://cdn.example/a.flac","codec":"flac","sampleRate":96000,"bitDepth":24}"#.to_string(),
                        "/tok/stream/leak" => r#"{"url":"http://10.0.0.5/a.flac"}"#.to_string(),
                        "/tok/lyrics?q=Song" => r#"{"lyrics":[{"syncedLyrics":"[00:01.00]Line","source":"Mock"}]}"#.to_string(),
                        "/tok/translate?q=Line" => r#"{"translation":"Translated"}"#.to_string(),
                        "/tok/album/7" | "/tok/artist/7" => r#"{"tracks":[{"id":7,"title":"Song","artist":"A"}]}"#.to_string(),
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
    async fn test_eclipse_addon_search_and_stream() {
        let c = build_client(true);
        let base = base_from_manifest_url(&mock_server().await).unwrap();
        assert!(base.path().ends_with("/tok"), "manifest.json stripped, token kept: {base}");

        let m = fetch_manifest(&c, &base).await.unwrap();
        assert_eq!(m.id, "com.test.mock");
        assert_eq!(m.icon, None, "non-http icon dropped");

        let tracks = search(&c, &m.id, &base, "hello world").await.unwrap();
        assert_eq!(tracks.len(), 1, "malformed item skipped, not fatal");
        assert_eq!(tracks[0].id, "com.test.mock:7");
        assert_eq!(tracks[0].duration, Some(240));
        assert_eq!(tracks[0].cover_url.as_deref(), Some("https://x/y.jpg"));
        assert_eq!(tracks[0].recording_evidence.isrc.as_deref(), Some("USRC12345678"));

        let s = resolve(&c, &base, "track 1").await.unwrap();
        assert_eq!(s.url, "https://cdn.example/a.flac");
        assert_eq!(s.quality.lossless, Some(true));
        assert_eq!((s.quality.sample_rate, s.quality.bit_depth), (Some(96000.0), Some(24)));

        // A local addon may hand back LAN stream URLs; error text must not echo the token URL.
        assert!(resolve(&c, &base, "leak").await.is_ok());
        let err = resolve(&c, &base, "missing").await.unwrap_err();
        assert!(!err.contains("tok"), "error leaked URL: {err}");

        let big = get_json::<serde_json::Value>(&c, endpoint(&base, &["big"]), Duration::from_secs(5)).await;
        assert!(big.is_err(), "3 MiB body must exceed the cap");
    }

    #[tokio::test]
    async fn extension_resources_and_catalog_routes() {
        let c = build_client(true);
        let base = base_from_manifest_url(&mock_server().await).unwrap();
        assert_eq!(lyrics(&c, &base, "Song").await.unwrap()[0]["source"], "Mock");
        assert_eq!(translate(&c, &base, "Line").await.unwrap(), "Translated");
        for resource in ["album", "artist"] {
            assert_eq!(catalog(&c, "com.test.mock", &base, resource, "7").await.unwrap()[0].id, "com.test.mock:7");
        }
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
}
