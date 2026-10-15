use super::YoutubeTrack;

lazy_static::lazy_static! {
    static ref COVER_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcover\s+by\b").unwrap(),
        regex::Regex::new(r"\bcover\s+version\b").unwrap(),
        regex::Regex::new(r"[\(\[][^)]*\bcover\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcover\s+of\b").unwrap(),
        regex::Regex::new(r"\bacoustic\s+cover\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+cover\b").unwrap(),
        regex::Regex::new(r"\bguitar\s+cover\b").unwrap(),
        regex::Regex::new(r"\bviolin\s+cover\b").unwrap(),
        regex::Regex::new(r"\bmetal\s+cover\b").unwrap(),
        regex::Regex::new(r"\bdrum\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcell\s+cover\b").unwrap(),
        regex::Regex::new(r"\bflute\s+cover\b").unwrap(),
        regex::Regex::new(r"\bharp\s+cover\b").unwrap(),
        // Remix/edit patterns
        regex::Regex::new(r"[\(\[][^)]*\bremix\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+remix\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
        regex::Regex::new(r"\bslowed[- ](?:reverb|down|\+\s*reverb)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\s+version\b").unwrap(),
        regex::Regex::new(r"\b8d\s+(?:audio|version|mix)\b").unwrap(),
        // Compilation/playlist patterns
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\btop\s+\d+\s+songs\b").unwrap(),
        regex::Regex::new(r"\bnonstop\s+mix\b").unwrap(),
        regex::Regex::new(r"\bfull\s+playlist\b").unwrap(),
        regex::Regex::new(r"\bgreatest\s+hits\b").unwrap(),
    ];
    static ref ARTIST_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcovers\b").unwrap(),
        regex::Regex::new(r"\bcover\s+nation\b").unwrap(),
        regex::Regex::new(r"\bcover\s+channel\b").unwrap(),
        regex::Regex::new(r"\bcover\s+band\b").unwrap(),
        regex::Regex::new(r"\btribute\s+band\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+tribute\b").unwrap(),
        regex::Regex::new(r"\btribute\s+orchestra\b").unwrap(),
        // Compilation/playlist channel patterns
        regex::Regex::new(r"\bmusic\s+(?:hits|vibes|collection|zone)\b").unwrap(),
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\bplaylist\b").unwrap(),
        regex::Regex::new(r"\bcompilation\b").unwrap(),
        regex::Regex::new(r"\btop\s+(?:hits|songs|tracks)\b").unwrap(),
        regex::Regex::new(r"\bremix\s+(?:channel|music|official)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
    ];
}

/// Extracts the clean 11-character YouTube video ID from various URL formats or raw IDs.
pub fn extract_video_id(url_or_id: &str) -> Option<String> {
    let trimmed = url_or_id.trim();
    if trimmed.is_empty() {
        return None;
    }
    // If it's already a clean 11-char ID
    if trimmed.len() == 11 && trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Some(trimmed.to_string());
    }
    if let Ok(parsed) = url::Url::parse(trimmed) {
        let host = parsed.host_str().unwrap_or("");
        if host == "youtu.be" || host.ends_with(".youtu.be") {
            let path = parsed.path().trim_start_matches('/');
            let id = path.split('/').next().unwrap_or("");
            let clean_id = id.split(['?', '&', '#']).next().unwrap_or("");
            if clean_id.len() == 11 && clean_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Some(clean_id.to_string());
            }
        } else if host == "youtube.com" || host.ends_with(".youtube.com") {
            if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "v") {
                let clean_id = v.trim();
                if clean_id.len() == 11 && clean_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                    return Some(clean_id.to_string());
                }
            }
            let path_segments: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
            for (idx, seg) in path_segments.iter().enumerate() {
                if (*seg == "embed" || *seg == "v" || *seg == "shorts" || *seg == "live") && idx + 1 < path_segments.len() {
                    let cand = path_segments[idx + 1];
                    if cand.len() == 11 && cand.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                        return Some(cand.to_string());
                    }
                }
            }
        }
    }
    lazy_static::lazy_static! {
        static ref RE_YT_ID: regex::Regex = regex::Regex::new(r#"(?:v=|\/embed\/|\/v\/|\/shorts\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})"#).unwrap();
    }
    RE_YT_ID.captures(trimmed).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

pub fn is_third_party_or_instrumental(title: &str, artist: &str) -> bool {
    let title_lower = title.to_lowercase();
    let artist_lower = artist.to_lowercase();

    // 1. Direct title keyword contains
    let title_keywords = [
        "podcast",
        "interview",
        "vlog",
        "karaoke",
        "backing track",
        "backing tracks",
        "synthesia",
        "music box version",
        "music box cover",
        "tribute version",
        "8-bit",
        "8bit",
        "midi",
        "cgbspins",
        "singalong",
        "sing along",
        "tutorials",
        "piano tutorial",
        "karaoke version",
        "karaoke track",
        "karaoke mix",
        "8-bit cover",
        "8bit cover",
        "lofi cover",
        "lo-fi cover",
        // Remix/edit variants
        "sped up",
        "sped-up",
        "speed up",
        "spedup",
        "speedup",
        "slowed reverb",
        "slowed + reverb",
        "slowed+reverb",
        "slowed down",
        "slowed",
        "nightcore",
        "8d audio",
        "piano cover",
        "acoustic cover",
        "guitar cover",
        // Promotional/Live/Performance show filters
        "studio choom",
        "스튜디오 춤",
        "fancam",
        "직캠",
        "dance practice",
        "choreography",
        "choreo",
        "stage mix",
        "special stage",
        "comeback stage",
        "line distribution",
        "color coded",
        "color-coded",
        "m countdown",
        "mcountdown",
        "music bank",
        "inkigayo",
        "show champion",
        "kbs kpop",
        "sbs kpop",
        "mnet",
        "m2",
        "official teaser",
        "music video teaser",
        "official trailer",
        "behind the scenes",
        "reaction video",
        "reaction",
        "reacts",
        "reacting",
        "react to",
        "first time hearing",
        "first time listening",
        "honest review",
        "mv reaction",
        "live reaction",
        "vocal coach",
        "vocal analysis",
        "breakdown",
        "relay dance",
        "dance cover",
        "unboxing",
        "live stream",
        "livestream",
        "lyric video",
        "lyrics video",
        "visualizer video",
        "tiktok compilation",
        "status video",
        "whatsapp status",
        "shorts",
        "#shorts",
        "challenge",
        // Compilation signals in title
        "greatest hits",
        "best of",
        "nonstop mix",
        "non-stop mix",
        "full playlist",
        "top hits",
        "top songs",
        "lagu viral",
        "viral tiktok",
        "tiktok viral",
        "full album",
        "album mp3",
        "compilation",
        "mashup",
        "fanmade",
        "fan-made",
    ];

    for &kw in &title_keywords {
        if title_lower.contains(kw) {
            return true;
        }
    }

    // 2. Specific regex patterns for covers/remixes in title
    for re in COVER_REGEXES.iter() {
        if re.is_match(&title_lower) {
            return true;
        }
    }

    // 3. Direct artist/channel keywords
    let artist_keywords = [
        "karaoke",
        "tribute",
        "synthesia",
        "music box",
        "sing king",
        "backing tracks",
        "karaoke academy",
        "karaoke tracks",
        "backing track",
        "nightcore",
        "sped up",
        "sped-up",
        "lirik",
        "lyrics channel",
        "lagu terbaik",
        "reaction",
        "reacts",
        "vocal coach",
        // Promotional/Live/Performance channels
        "studio choom",
        "스튜디오 춤",
        "kbs kpop",
        "sbs kpop",
        "m countdown",
        "mnet",
        "m2",
        "line distribution",
        "fancam",
        // Generic Western/Global Curators & Promoters
        "vevo control",
        "vevo lift",
        "curator",
        "promotion",
        "promotions",
        "promo",
        "network",
        "lyrics channel",
        "lyric channel",
        "7clouds",
        "cloudkid",
        "proximity",
        "trap nation",
        "chill nation",
        "house nation",
        "bass nation",
        "rap nation",
        "indie nation",
        "syrebralvibes",
        "taj tracks",
        "music blog",
    ];

    for &kw in &artist_keywords {
        if artist_lower.contains(kw) {
            return true;
        }
    }

    // 4. Specific regex patterns for artist/channel names
    for re in ARTIST_REGEXES.iter() {
        if re.is_match(&artist_lower) {
            return true;
        }
    }

    false
}

/// Returns true if the artist/channel name looks like a third-party playlist
/// or compilation channel rather than an actual music artist.
pub fn is_compilation_channel(artist: &str) -> bool {
    let a = artist.to_lowercase();
    // Known junk channel patterns
    let patterns = [
        "playlist", "compilation", "best of", "top hits", "top songs",
        "music hits", "hit music", "music collection", "music zone",
        "music vibes", "viral hits", "trending music", "nonstop", "non-stop",
        "lagu terbaik", "lagu viral", "koleksi lagu", "full album",
        "greatest hits", "official lyric", "lyric video", "lyrics channel",
        "remix official", "remix channel",
        // Curators/Blogs
        "curator", "promotion", "promotions", "music blog", "lyric channel",
        "7clouds", "cloudkid", "proximity", "trap nation", "chill nation",
        "house nation", "bass nation", "rap nation", "indie nation",
        "syrebralvibes", "taj tracks",
    ];
    for &pat in &patterns {
        if a.contains(pat) {
            return true;
        }
    }
    false
}

pub fn clean_title(title: &str) -> String {
    let mut title_lower = title.to_lowercase();
    if let Ok(re) = regex::Regex::new(r"[\(\[][^\)\]]+[\)\]]") {
        title_lower = re.replace_all(&title_lower, "").into_owned();
    }
    if let Some(idx) = title_lower.find(" feat.") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" ft.") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" featuring") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" official audio") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" official video") { title_lower.truncate(idx); }
    title_lower.trim().to_string()
}

pub fn is_semantic_noise(title: &str, seed_title: &str) -> bool {
    let title_lower = title.to_lowercase();
    let seed_lower = seed_title.to_lowercase();
    let noise_words = ["karaoke", "backing track", "tribute", "cover", "acapella", "8d"];
    for &word in &noise_words {
        if title_lower.contains(word) && !seed_lower.contains(word) {
            return true;
        }
    }
    false
}

pub fn fuzzy_title_similarity(s1: &str, s2: &str) -> f64 {
    let s1_clean = clean_title(s1);
    let s2_clean = clean_title(s2);
    if s1_clean == s2_clean {
        return 1.0;
    }
    let s1_chars: Vec<char> = s1_clean.chars().collect();
    let s2_chars: Vec<char> = s2_clean.chars().collect();
    if s1_chars.len() < 2 || s2_chars.len() < 2 {
        return if s1_clean == s2_clean { 1.0 } else { 0.0 };
    }

    let mut s1_bigrams = std::collections::HashSet::new();
    for i in 0..s1_chars.len() - 1 {
        s1_bigrams.insert((s1_chars[i], s1_chars[i+1]));
    }

    let mut s2_bigrams = std::collections::HashSet::new();
    for i in 0..s2_chars.len() - 1 {
        s2_bigrams.insert((s2_chars[i], s2_chars[i+1]));
    }

    let intersection = s1_bigrams.intersection(&s2_bigrams).count();
    let total = s1_bigrams.len() + s2_bigrams.len();
    if total == 0 {
        return 0.0;
    }
    (2.0 * intersection as f64) / total as f64
}

/// Normalizes artist name by stripping noise like brackets, topic suffixes, VEVO, and special characters.
pub fn normalize_artist_name(name: &str) -> String {
    let mut s = name.to_lowercase();
    if let Ok(re) = regex::Regex::new(r"[\(\[][^\)\]]+[\)\]]") {
        s = re.replace_all(&s, "").into_owned();
    }
    s = s.replace("- topic", "")
        .replace(" - topic", "")
        .replace("official", "")
        .replace("vevo", "")
        .replace("records", "")
        .replace("entertainment", "");
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Checks if a candidate artist matches an expected target artist (handling official channels, transliterations, and acronyms).
pub fn artist_matches(candidate: &str, expected: &str) -> bool {
    let cand_norm = normalize_artist_name(candidate);
    let exp_norm = normalize_artist_name(expected);

    if cand_norm.is_empty() || exp_norm.is_empty() {
        return false;
    }
    if cand_norm == exp_norm || cand_norm.contains(&exp_norm) || exp_norm.contains(&cand_norm) {
        return true;
    }
    // Token overlap comparison
    let exp_tokens: Vec<&str> = exp_norm.split_whitespace().filter(|w| w.len() >= 2).collect();
    let cand_tokens: Vec<&str> = cand_norm.split_whitespace().filter(|w| w.len() >= 2).collect();
    if !exp_tokens.is_empty() {
        let matches = exp_tokens.iter().any(|et| cand_tokens.contains(et));
        if matches {
            return true;
        }
    }
    false
}

/// Capitalises the first character of a string slice (used for genre labels).
pub fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

pub fn interleave_tracks(online: Vec<YoutubeTrack>, local: Vec<YoutubeTrack>, limit: usize) -> Vec<YoutubeTrack> {
    let mut interleaved = Vec::new();
    let mut online_iter = online.into_iter();
    let mut local_iter = local.into_iter();

    while interleaved.len() < limit {
        match (local_iter.next(), online_iter.next()) {
            (Some(l), Some(o)) => {
                interleaved.push(l);
                if interleaved.len() < limit {
                    interleaved.push(o);
                }
            }
            (Some(l), None) => {
                interleaved.push(l);
            }
            (None, Some(o)) => {
                interleaved.push(o);
            }
            (None, None) => {
                break;
            }
        }
    }
    interleaved
}

/// Normalized identity key for a track, aligned with the library-signature
/// format used by the discovery hub (normalize_artist_name + clean_title).
pub fn yt_track_signature(t: &YoutubeTrack) -> String {
    format!("{}::{}", normalize_artist_name(&t.artist), clean_title(&t.title))
}

pub fn parse_duration_seconds(duration_raw: &str) -> Option<u64> {
    let mut parts = duration_raw.split(':');
    let first = parts.next()?.trim().parse::<u64>().ok()?;
    let second = parts.next()?.trim().parse::<u64>().ok()?;
    match parts.next() {
        Some(seconds) if parts.next().is_none() => {
            let seconds = seconds.trim().parse::<u64>().ok()?;
            Some(first.saturating_mul(3600).saturating_add(second.saturating_mul(60)).saturating_add(seconds))
        }
        None => Some(first.saturating_mul(60).saturating_add(second)),
        _ => None,
    }
}

pub fn is_duration_too_long(duration_raw: &str) -> bool {
    parse_duration_seconds(duration_raw).is_some_and(|seconds| seconds > 900)
}

pub fn is_known_duration_within_limit(duration_raw: &str) -> bool {
    parse_duration_seconds(duration_raw).is_some_and(|seconds| seconds > 0 && seconds <= 900)
}

/// Merges online duplicate sources into the matching shelf track's source_context
/// instead of silently discarding them, and returns only non-duplicate online tracks.
pub fn dedupe_online_against_shelf(
    local_shelf: &mut [YoutubeTrack],
    online: Vec<YoutubeTrack>,
    library_signatures: &std::collections::HashSet<String>,
) -> Vec<YoutubeTrack> {
    let mut kept = Vec::new();
    for online_track in online {
        let sig = yt_track_signature(&online_track);
        if let Some(matching_local) = local_shelf.iter_mut().find(|lt| yt_track_signature(lt) == sig) {
            let yt_source = crate::db::PlaybackSource {
                provider: crate::db::SourceProvider::Youtube,
                id: online_track.id.clone(),
                catalog_quality: None,
                metadata: Some(crate::db::SourceMetadata {
                    title: Some(online_track.title.clone()),
                    artist: Some(online_track.artist.clone()),
                    album: None,
                    duration: None,
                    duration_raw: Some(online_track.duration_raw.clone()),
                    cover_url: online_track.cover_url.clone(),
                    track_number: None,
                    disc_number: None,
                }),
            };
            let ctx = matching_local.source_context.get_or_insert_with(|| {
                let local_source = crate::db::PlaybackSource {
                    provider: crate::db::SourceProvider::Local,
                    id: matching_local.url.clone(),
                    catalog_quality: None,
                    metadata: Some(crate::db::SourceMetadata {
                        title: Some(matching_local.title.clone()),
                        artist: Some(matching_local.artist.clone()),
                        album: None,
                        duration: None,
                        duration_raw: Some(matching_local.duration_raw.clone()),
                        cover_url: matching_local.cover_url.clone(),
                        track_number: None,
                        disc_number: None,
                    }),
                };
                crate::db::RecordingSources {
                    recording_id: matching_local.id.clone(),
                    sources: vec![local_source],
                    selection: crate::db::SourceSelection::Auto,
                }
            });
            if !ctx.sources.iter().any(|s| s.provider == crate::db::SourceProvider::Youtube && s.id == online_track.id) {
                ctx.sources.push(yt_source);
            }
        } else if !library_signatures.contains(&sig) {
            kept.push(online_track);
        }
    }
    kept
}

/// Backward-compatible wrapper for library signature deduplication
pub fn dedupe_online_against_library(
    online: Vec<YoutubeTrack>,
    library_signatures: &std::collections::HashSet<String>,
) -> Vec<YoutubeTrack> {
    let mut dummy_shelf = Vec::new();
    dedupe_online_against_shelf(&mut dummy_shelf, online, library_signatures)
}

/// Blends online tracks into an ordered local shelf without an obvious
/// local/online/local/online cadence: each online track is inserted at a
/// random position, preserving the relative order of the local list.
pub fn blend_shelf_naturally(
    local: Vec<YoutubeTrack>,
    online: Vec<YoutubeTrack>,
    cap: usize,
) -> Vec<YoutubeTrack> {
    use rand::Rng;
    let mut rng = rand::rng();

    let mut blended: Vec<YoutubeTrack> = local;
    for track in online {
        if blended.len() >= cap {
            break;
        }
        let insert_at = rng.random_range(0..=blended.len());
        blended.insert(insert_at, track);
    }
    blended.truncate(cap);
    blended
}

/// Splits leftover non-library history entries between the Heavy Rotation and
/// Forgotten Gems shelves without reusing any entry in both pools.
pub fn split_unmatched_for_shelves(
    pairs: Vec<(String, String)>,
    rotation_cap: usize,
    gems_cap: usize,
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut rotation = Vec::new();
    let mut gems = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for pair in pairs {
        let key = format!("{}::{}", pair.1.to_lowercase(), pair.0.to_lowercase());
        if !seen.insert(key) {
            continue;
        }
        if rotation.len() < rotation_cap {
            rotation.push(pair);
        } else if gems.len() < gems_cap {
            gems.push(pair);
        } else {
            break;
        }
    }
    (rotation, gems)
}

pub fn daily_recommendation_rng() -> rand::rngs::StdRng {
    use rand::SeedableRng;
    let day = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() / 86_400).unwrap_or(0);
    rand::rngs::StdRng::seed_from_u64(day)
}

pub fn recording_title(title: &str) -> String {
    static PRESENTATION: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)\s*(?:[\(\[]\s*(?:official\s+(?:audio|music video|video)|audio|lyrics?|hd|4k)\s*[\)\]]|\s+-\s+official\s+(?:audio|music video|video))\s*").unwrap()
    });
    PRESENTATION.replace_all(title, " ").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn recording_matches(track: &YoutubeTrack, artist: &str, title: &str) -> bool {
    artist_matches(&track.artist, artist) && !title.trim().is_empty()
        && recording_title(&track.title) == recording_title(title)
        && is_known_duration_within_limit(&track.duration_raw)
}

pub fn saved_track_source_id(track: &crate::db::Track) -> String {
    if saved_track_provider(track) == crate::db::SourceProvider::Youtube {
        extract_video_id(&track.path).unwrap_or_else(|| track.path.clone())
    } else {
        track.path.strip_prefix("tidal:").or_else(|| track.path.strip_prefix("qobuz:"))
            .map(|id| id.trim_start_matches('/').to_string()).unwrap_or_else(|| track.path.clone())
    }
}

pub fn saved_track_provider(track: &crate::db::Track) -> crate::db::SourceProvider {
    let format = track.format.as_deref().unwrap_or("").to_ascii_lowercase();
    if format.contains("qobuz") || track.path.starts_with("qobuz:") { crate::db::SourceProvider::Qobuz }
    else if format.contains("tidal") || track.path.starts_with("tidal:") { crate::db::SourceProvider::Tidal }
    else if format.contains("youtube") || extract_video_id(&track.path).is_some() { crate::db::SourceProvider::Youtube }
    else { crate::db::SourceProvider::Local }
}
