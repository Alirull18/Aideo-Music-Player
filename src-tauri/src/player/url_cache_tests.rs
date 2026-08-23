#[cfg(test)]
mod url_cache_tests {
    use std::time::{Duration, Instant};

    use crate::player::{
        get_cached_youtube_url, insert_cached_youtube_url, invalidate_youtube_url_if,
        clear_youtube_url_cache, YOUTUBE_URL_TTL,
    };

    // Regression lock for the stale googlevideo URL bug: resolved YouTube direct
    // stream URLs expire server-side (~6h). The cache must serve entries only
    // within TTL, prune expired ones, and allow surgical eviction of entries
    // whose direct URL is known-bad without touching freshly re-resolved ones.

    #[test]
    fn test_youtube_url_cache_roundtrip_within_ttl() {
        let key = "https://youtube.com/watch?v=roundtrip";
        let t0 = Instant::now();
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/videoplayback?a".to_string(), t0);

        // Halfway through the TTL the entry must still be served.
        let got = get_cached_youtube_url(key, t0 + YOUTUBE_URL_TTL / 2);
        assert_eq!(got.as_deref(), Some("https://googlevideo.com/videoplayback?a"));
    }

    #[test]
    fn test_youtube_url_cache_expires_after_ttl() {
        let key = "https://youtube.com/watch?v=expired";
        let t0 = Instant::now();
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/videoplayback?b".to_string(), t0);

        // Googlevideo links die after ~6h; past TTL the cache must report a miss...
        assert_eq!(get_cached_youtube_url(key, t0 + YOUTUBE_URL_TTL + Duration::from_secs(1)), None);
        // ...and physically prune the dead entry instead of resurrecting it later.
        assert_eq!(get_cached_youtube_url(key, t0), None);
    }

    #[test]
    fn test_youtube_url_cache_reinsert_refreshes_timestamp() {
        let key = "https://youtube.com/watch?v=reinsert";
        let t0 = Instant::now();
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/old".to_string(), t0);
        // Re-resolved 4h later must reset the clock on the new value.
        let t1 = t0 + Duration::from_secs(4 * 3600);
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/new".to_string(), t1);
        assert_eq!(get_cached_youtube_url(key, t1 + YOUTUBE_URL_TTL - Duration::from_secs(1)).as_deref(), Some("https://googlevideo.com/new"));
    }

    #[test]
    fn test_invalidate_removes_matching_dead_url() {
        let key = "https://youtube.com/watch?v=evict";
        let t0 = Instant::now();
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/dead".to_string(), t0);

        invalidate_youtube_url_if(key, "https://googlevideo.com/dead");
        assert_eq!(get_cached_youtube_url(key, t0), None);
    }

    #[test]
    fn test_invalidate_keeps_freshly_reresolved_url() {
        // A background pre-resolve may replace the entry while a playback attempt
        // is still failing against the old URL. Eviction must be conditional so
        // we never throw away the good new URL.
        let key = "https://youtube.com/watch?v=race";
        let t0 = Instant::now();
        insert_cached_youtube_url(key.to_string(), "https://googlevideo.com/fresh".to_string(), t0);

        invalidate_youtube_url_if(key, "https://googlevideo.com/stale");
        assert_eq!(get_cached_youtube_url(key, t0).as_deref(), Some("https://googlevideo.com/fresh"));
    }

    #[test]
    fn test_invalidate_unknown_key_is_noop() {
        invalidate_youtube_url_if("https://youtube.com/watch?v=never-inserted", "whatever");
    }

    #[test]
    fn test_clear_youtube_url_cache_empties_all_entries() {
        let t0 = Instant::now();
        insert_cached_youtube_url("k1".to_string(), "d1".to_string(), t0);
        insert_cached_youtube_url("k2".to_string(), "d2".to_string(), t0);
        clear_youtube_url_cache();
        assert_eq!(get_cached_youtube_url("k1", t0), None);
        assert_eq!(get_cached_youtube_url("k2", t0), None);
    }
}
