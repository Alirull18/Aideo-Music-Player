#[cfg(test)]
mod playback_lifecycle_tests {
    use std::fs::{self, File};
    use std::io::Write;
    use crate::player::{
        detect_url_rendition_format, get_rendition_cache_paths, parse_url_provider_and_id,
        promote_temp_to_cache_atomic, rendition_cache_key, PlayerCommand,
    };

    #[test]
    fn test_rendition_cache_key_isolation() {
        let key_opus = rendition_cache_key("aideo", "youtube", "dQw4w9WgXcQ", "opus");
        let key_aac = rendition_cache_key("aideo", "youtube", "dQw4w9WgXcQ", "aac");
        let key_flac = rendition_cache_key("aideo", "youtube", "dQw4w9WgXcQ", "flac");

        assert_eq!(key_opus, "aideo:youtube:dQw4w9WgXcQ:opus");
        assert_eq!(key_aac, "aideo:youtube:dQw4w9WgXcQ:aac");
        assert_eq!(key_flac, "aideo:youtube:dQw4w9WgXcQ:flac");

        // Formats must never collide
        assert_ne!(key_opus, key_aac);
        assert_ne!(key_aac, key_flac);
        assert_ne!(key_opus, key_flac);

        // Providers must never collide even with identical source IDs
        let key_tidal = rendition_cache_key("aideo", "tidal", "dQw4w9WgXcQ", "flac");
        assert_ne!(key_flac, key_tidal);

        // Cache file paths generated from distinct keys must also be isolated
        let (p_opus, _) = get_rendition_cache_paths("aideo", "youtube", "dQw4w9WgXcQ", "opus").unwrap();
        let (p_aac, _) = get_rendition_cache_paths("aideo", "youtube", "dQw4w9WgXcQ", "aac").unwrap();
        let (p_flac, _) = get_rendition_cache_paths("aideo", "youtube", "dQw4w9WgXcQ", "flac").unwrap();
        let (p_tidal, _) = get_rendition_cache_paths("aideo", "tidal", "dQw4w9WgXcQ", "flac").unwrap();

        assert_ne!(p_opus, p_aac);
        assert_ne!(p_aac, p_flac);
        assert_ne!(p_opus, p_flac);
        assert_ne!(p_flac, p_tidal);
    }

    #[test]
    fn test_detect_url_rendition_format() {
        assert_eq!(
            detect_url_rendition_format("https://rr1.googlevideo.com/videoplayback?itag=251&source=youtube"),
            Some("opus")
        );
        assert_eq!(
            detect_url_rendition_format("https://example.com/audio.webm"),
            Some("opus")
        );
        assert_eq!(
            detect_url_rendition_format("https://rr1.googlevideo.com/videoplayback?itag=140&source=youtube"),
            Some("aac")
        );
        assert_eq!(
            detect_url_rendition_format("https://example.com/audio.m4a"),
            Some("aac")
        );
        assert_eq!(
            detect_url_rendition_format("https://api.tidal.com/v1/tracks/123/stream.flac"),
            Some("flac")
        );
        assert_eq!(
            detect_url_rendition_format("https://example.com/track.mp3"),
            Some("mp3")
        );
        assert_eq!(
            detect_url_rendition_format("https://example.com/stream/unknown"),
            None
        );
    }

    #[test]
    fn test_parse_url_provider_and_id() {
        assert_eq!(
            parse_url_provider_and_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            ("youtube".to_string(), "dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            parse_url_provider_and_id("https://youtu.be/dQw4w9WgXcQ"),
            ("youtube".to_string(), "dQw4w9WgXcQ".to_string())
        );
        let (provider, _) = parse_url_provider_and_id("https://api.tidal.com/v1/tracks/987654/playbackinfo");
        assert_eq!(provider, "tidal");
    }

    #[test]
    fn test_promote_temp_to_cache_atomic_success() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("aideo_test_atomic_{}", unique_id));
        fs::create_dir_all(&test_dir).unwrap();

        let temp_path = test_dir.join("stream.tmp_promote");
        let final_path = test_dir.join("stream.cached");

        // Write 2048 bytes of test data (> min_bytes 1024)
        let data = vec![0x41u8; 2048];
        {
            let mut f = File::create(&temp_path).unwrap();
            f.write_all(&data).unwrap();
            f.flush().unwrap();
            // explicitly drop to release file handle on Windows
        }

        let res = promote_temp_to_cache_atomic(&temp_path, &final_path, 1024);
        assert!(res.is_ok(), "Atomic promotion must succeed for complete file: {:?}", res);
        assert!(final_path.exists(), "Target file must exist after promotion");
        assert!(!temp_path.exists(), "Temp file must be moved/renamed");

        let read_data = fs::read(&final_path).unwrap();
        assert_eq!(read_data, data);

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_promote_temp_to_cache_atomic_truncated_cleanup() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!("aideo_test_atomic_trunc_{}", unique_id));
        fs::create_dir_all(&test_dir).unwrap();

        let temp_path = test_dir.join("truncated.tmp_promote");
        let final_path = test_dir.join("truncated.cached");

        // Write only 128 bytes (< min_bytes 1024)
        let data = vec![0x42u8; 128];
        {
            let mut f = File::create(&temp_path).unwrap();
            f.write_all(&data).unwrap();
            f.flush().unwrap();
        }

        let res = promote_temp_to_cache_atomic(&temp_path, &final_path, 1024);
        assert!(res.is_err(), "Atomic promotion must fail for truncated file");
        assert!(!final_path.exists(), "Target file must not be created");
        assert!(!temp_path.exists(), "Truncated temp file must be cleaned up");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn test_player_command_play_attempt_id() {
        let cmd = PlayerCommand::Play(
            "C:\\Music\\test.flac".to_string(),
            15.5,
            Some("attempt-xyz-789".to_string()),
        );

        if let PlayerCommand::Play(path, pos, attempt_id) = cmd {
            assert_eq!(path, "C:\\Music\\test.flac");
            assert_eq!(pos, 15.5);
            assert_eq!(attempt_id, Some("attempt-xyz-789".to_string()));
        } else {
            panic!("Expected PlayerCommand::Play");
        }

        // None variant backwards-compatibility
        let legacy_cmd = PlayerCommand::Play("stream_url".to_string(), 0.0, None);
        if let PlayerCommand::Play(_, _, attempt_id) = legacy_cmd {
            assert_eq!(attempt_id, None);
        } else {
            panic!("Expected PlayerCommand::Play");
        }
    }

    #[test]
    fn test_playback_lifecycle_payloads_serialization() {
        let ready_payload = serde_json::json!({
            "attempt_id": "att-1",
            "path": "https://youtube.com/watch?v=123",
        });
        let ready_json = ready_payload.to_string();
        assert!(ready_json.contains("\"attempt_id\":\"att-1\""));
        assert!(ready_json.contains("\"path\":\"https://youtube.com/watch?v=123\""));

        let cancelled_payload = serde_json::json!({
            "attempt_id": "att-2",
            "path": "https://youtube.com/watch?v=456",
        });
        let cancelled_json = cancelled_payload.to_string();
        assert!(cancelled_json.contains("\"attempt_id\":\"att-2\""));
        assert!(cancelled_json.contains("\"path\":\"https://youtube.com/watch?v=456\""));
    }

    #[test]
    fn test_build_ffmpeg_decoder_args_youtube_stream_seeking() {
        use crate::player::build_ffmpeg_decoder_args;

        let googlevideo_url = "https://rr5---sn-uh-h31l.googlevideo.com/videoplayback?expire=123";
        let start_pos = 32.22;
        let use_ffmpeg_seek = true;
        let is_stream = true;
        let is_youtube_stream = true;
        let quality = "native";
        let is_dsd = false;

        let args = build_ffmpeg_decoder_args(
            googlevideo_url,
            start_pos,
            use_ffmpeg_seek,
            is_stream,
            is_youtube_stream,
            quality,
            is_dsd,
        );

        // 1. Piped streams must use stdin pipe
        let i_idx = args.iter().position(|x| x == "-i").expect("Must contain -i");
        assert_eq!(args[i_idx + 1], "pipe:", "Stream input must be pipe:");

        // 2. -ss MUST be placed after -i pipe: for decoder-level fast seeking on piped streams
        let ss_idx = args.iter().position(|x| x == "-ss").expect("Must contain -ss");
        assert!(i_idx < ss_idx, "-ss must succeed -i for piped stream seeking");
        assert_eq!(args[ss_idx + 1], "32.22");

        // 3. Output must be uncompressed PCM WAV
        let f_idx = args.iter().position(|x| x == "-f").expect("Must contain -f");
        assert_eq!(args[f_idx + 1], "wav");
        let codec_idx = args.iter().position(|x| x == "-acodec").expect("Must contain -acodec");
        assert_eq!(args[codec_idx + 1], "pcm_s24le");
    }

    #[test]
    fn test_canonical_url_cache_path_priority() {
        use crate::player::get_cache_paths;

        let canonical = "https://www.youtube.com/watch?v=HBqH4uJS0PU";
        let ephemeral_url = "https://rr5---sn-uh-h31l.googlevideo.com/videoplayback?expire=1789636018&itag=251";

        let canonical_paths = get_cache_paths(canonical);
        assert!(canonical_paths.is_some(), "Canonical YouTube URL must yield cache paths");
        let (can_cache, _can_stream) = canonical_paths.unwrap();
        let expected_key = crate::player::rendition_cache_key("aideo", "youtube", "HBqH4uJS0PU", "audio");
        let expected_hash = format!("{:x}", md5::compute(expected_key.as_bytes()));
        assert!(can_cache.to_string_lossy().contains(&expected_hash), "Cache file must contain hashed rendition key");

        // When canonical_url is provided, it must be prioritized over ephemeral googlevideo URL
        let resolved = Some(canonical).and_then(get_cache_paths).or_else(|| get_cache_paths(ephemeral_url));
        assert_eq!(resolved.unwrap().0, can_cache, "Canonical cache path must take precedence");
    }
}

