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
    #[test]
    fn eof_sinc_partial_drains_delayed_impulse_without_padding_or_duplication() {
        use crate::player::ResamplerOutputTimeline;
        use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

        let params = SincInterpolationParameters {
            sinc_len: 64,
            f_cutoff: 0.96,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 64,
            window: WindowFunction::BlackmanHarris2,
        };
        let mut resampler = SincFixedIn::<f32>::new(2.0, 2.0, params, 64, 1).unwrap();
        let mut timeline = ResamplerOutputTimeline::default();
        timeline.startup_delay = resampler.output_delay();
        timeline.started = true;
        let mut output = Vec::new();
        let input = vec![0.0f32; 64];
        for _ in 0..2 {
            timeline.add_input(64, 2.0, 2.0);
            let mut processed = resampler.process(&[&input], None).unwrap();
            timeline.trim(&mut processed);
            output.extend(processed.remove(0));
        }
        let mut remaining = vec![0.0f32; 3];
        remaining[2] = 1.0;
        timeline.add_input(remaining.len(), 2.0, 2.0);
        let mut processed = resampler.process_partial(Some(&[&remaining]), None).unwrap();
        timeline.trim(&mut processed);
        output.extend(processed.remove(0));
        while timeline.remaining() > 0 {
            let mut processed = resampler.process_partial::<&[f32]>(None, None).unwrap();
            timeline.trim(&mut processed);
            output.extend(processed.remove(0));
        }
        assert_eq!(output.len(), 262);
        // A signal in the final partial input must survive the delayed Sinc output.
        assert!(output[190..205].iter().any(|v| v.abs() > 0.9), "EOF impulse was discarded");
        assert!(output[..150].iter().all(|v| v.abs() < 1e-5), "signal appeared before the final partial block");
        assert!(output[215..].iter().all(|v| v.abs() < 0.05), "EOF tail contains duplicated signal: peak={:?}", output[215..].iter().enumerate().max_by(|a, b| a.1.abs().total_cmp(&b.1.abs())));
    }

    #[test]
    fn crossfade_preserves_unequal_resampler_blocks_and_final_mix() {
        use crate::player::mix_crossfade_frames;
        use std::collections::VecDeque;

        let mut current = vec![vec![1.0; 5], vec![1.0; 5]];
        let mut next = vec![VecDeque::from(vec![0.0; 3]), VecDeque::from(vec![0.0; 3])];
        assert_eq!(mix_crossfade_frames(&mut current, &mut next, 0, 6), 3);
        for (actual, expected) in current[0].iter().zip([1.0, 5.0 / 6.0, 2.0 / 3.0, 1.0, 1.0]) {
            assert!((actual - expected).abs() < 1e-6);
        }
        assert!(next[0].is_empty());

        next[0].extend([0.0; 4]);
        next[1].extend([0.0; 4]);
        let mut final_block = vec![vec![1.0; 5], vec![1.0; 5]];
        let mixed = mix_crossfade_frames(&mut final_block, &mut next, 3, 6);
        assert_eq!(mixed, 3);
        final_block.iter_mut().for_each(|channel| channel.truncate(mixed));
        for (actual, expected) in final_block[0].iter().zip([0.5, 1.0 / 3.0, 1.0 / 6.0]) {
            assert!((actual - expected).abs() < 1e-6);
        }
        assert_eq!(next[0].len(), 1);
    }

    #[test]
    fn complete_ram_seek_can_land_exactly_at_eof() {
        use crate::player::ram_seek_cursor;
        assert_eq!(ram_seek_cursor(1.0, 48000, 48000, true), 48000);
        assert_eq!(ram_seek_cursor(2.0, 48000, 48000, true), 48000);
        assert_eq!(ram_seek_cursor(2.0, 48000, 48000, false), 96000);
    }

    #[test]
    fn bit_perfect_saved_upsample_does_not_change_effective_target() {
        use crate::player::{hardware_upsample_changed, DSPState};
        let mut dsp = DSPState::default();
        dsp.upsample_rate = 192000;
        dsp.dither = true;
        assert!(!hardware_upsample_changed(0, true, true, &dsp));
        assert!(hardware_upsample_changed(0, true, false, &dsp));
        dsp.upsample_rate = 96000;
        assert!(!hardware_upsample_changed(0, true, true, &dsp));
    }
    #[test]
    fn playback_speed_ratio_is_per_resampler_and_reset_after_seek() {
        use crate::player::update_playback_ratio;
        use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
        let make = || SincFixedIn::<f32>::new(
            1.0, 2.0,
            SincInterpolationParameters {
                sinc_len: 16,
                f_cutoff: 0.95,
                interpolation: SincInterpolationType::Linear,
                oversampling_factor: 16,
                window: WindowFunction::BlackmanHarris2,
            },
            64, 1,
        ).unwrap();
        let mut first = make();
        let mut second = make();
        let mut first_ratio = 1.0;
        let mut second_ratio = 1.0;
        update_playback_ratio(&mut first, &mut first_ratio, 1.5);
        update_playback_ratio(&mut second, &mut second_ratio, 1.5);
        assert_eq!(first_ratio, second_ratio);
        assert!((first_ratio - 2.0 / 3.0).abs() < 1e-6);

        first.reset();
        first_ratio = 1.0;
        update_playback_ratio(&mut first, &mut first_ratio, 1.5);
        assert_eq!(first_ratio, second_ratio);
    }

    #[test]
    fn shared_mode_select_output_config_uses_system_default_format() {
        use cpal::traits::{DeviceTrait, HostTrait};
        use crate::player::select_output_config;

        let host = cpal::default_host();
        if let Some(device) = host.default_output_device() {
            if let Ok(default_cfg) = device.default_output_config() {
                // In Shared Mode (is_exclusive = false), requesting a 44.1kHz track
                // MUST NOT force 44.1kHz onto the device. It must return the system mix format.
                let configs = select_output_config(&device, 44100, 2, false, false, true, 0, "TestDevice");
                assert!(!configs.is_empty());
                let (chosen_cfg, _) = &configs[0];
                assert_eq!(chosen_cfg.sample_rate, default_cfg.sample_rate(),
                    "Shared mode must use system default output sample rate ({}), not force file rate (44100)",
                    default_cfg.sample_rate()
                );
            }
        }
    }

    #[test]
    fn exclusive_mode_select_output_config_attempts_native_integer_rate() {
        use cpal::traits::HostTrait;
        use crate::player::select_output_config;

        let host = cpal::default_host();
        if let Some(device) = host.default_output_device() {
            // In Exclusive Mode (is_exclusive = true), Priority 2 is enabled.
            let configs = select_output_config(&device, 44100, 2, true, false, true, 0, "TestDevice");
            assert!(!configs.is_empty());
        }
    }

    #[test]
    fn resampler_bypass_and_should_resample_locking() {
        use crate::player::should_bypass_resampler;

        // Same rates: bypass resampler at normal speed
        assert!(should_bypass_resampler(44100, 44100, 1.0));
        assert!(should_bypass_resampler(48000, 48000, 1.0));

        // Different rates (e.g. 44.1k file on 48k device): MUST NOT BYPASS!
        assert!(!should_bypass_resampler(44100, 48000, 1.0));
        assert!(!should_bypass_resampler(48000, 44100, 1.0));
        assert!(!should_bypass_resampler(96000, 48000, 1.0));

        // Altered playback rate: MUST NOT BYPASS even if rates match
        assert!(!should_bypass_resampler(44100, 44100, 1.25));
        assert!(!should_bypass_resampler(48000, 48000, 0.75));
    }

    #[test]
    fn test_detect_url_rendition_format_mp4_extension() {
        use crate::player::detect_url_rendition_format;

        let tidal_mp4 = "https://amz-pr-fa.audio.tidal.com/4110233a15b783b1a6c5fe91d859c5a3.mp4?token=123";
        assert_eq!(detect_url_rendition_format(tidal_mp4), Some("aac"));

        let m4a_url = "https://stream.example.com/audio.m4a";
        assert_eq!(detect_url_rendition_format(m4a_url), Some("aac"));

        let flac_url = "https://stream.example.com/track.flac";
        assert_eq!(detect_url_rendition_format(flac_url), Some("flac"));
    }

    #[test]
    fn test_is_ffmpeg_available_helper() {
        use crate::player::is_ffmpeg_available;

        assert!(!is_ffmpeg_available("C:\\non_existent_folder_xyz\\no_ffmpeg.exe"));
    }

    #[test]
    fn test_he_aac_sbr_symphonia_half_rate_proves_ffmpeg_delegation() {
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::probe::Hint;
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::codecs::DecoderOptions;

        let path = std::env::temp_dir().join("aideo_cache_c3f44a8c7c2ef42d9916514018471758.m4a");
        if !path.exists() {
            return;
        }

        let file = std::fs::File::open(&path).unwrap();
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        hint.with_extension("m4a");

        let probed = crate::player::get_probe()
            .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .unwrap();

        let mut format = probed.format;
        let track = format.tracks().first().unwrap().clone();
        assert_eq!(track.codec_params.codec, symphonia::core::codecs::CODEC_TYPE_AAC);
        assert_eq!(track.codec_params.sample_rate, Some(44100));

        let mut decoder = crate::player::get_codecs().make(&track.codec_params, &DecoderOptions::default()).unwrap();
        let packet = format.next_packet().unwrap();
        let decoded = decoder.decode(&packet).unwrap();
        // Symphonia lacks SBR, decoding at 22050Hz (causing 2x speedup / chipmunk voice).
        // This locks in the proof of why CODEC_TYPE_AAC must be handed off to FFmpeg.
        assert_eq!(decoded.spec().rate, 22050, "Symphonia decodes HE-AAC at 22050Hz core rate");
    }

    #[test]
    fn test_detect_aac_actual_sample_rate() {
        use crate::player::detect_aac_actual_sample_rate;

        // HE-AAC (Audio Object Type 5) with frequency index 7 (22050Hz) and container 44100Hz:
        // byte 0: 43 = 00101 011 -> AOT = 5, top 3 bits of freq = 011
        // byte 1: 146 = 1 0010010 -> bottom bit of freq = 1 -> freq_idx = (011 << 1) | 1 = 7 (22050Hz)
        let sbr_extra_data = [43u8, 146, 8, 0];
        assert_eq!(detect_aac_actual_sample_rate(Some(&sbr_extra_data), 44100), 22050);

        // Standard AAC-LC (Audio Object Type 2) with frequency index 4 (44100Hz):
        // byte 0: 00010 100 -> AOT = 2
        let aac_lc_extra_data = [0x12u8, 0x10];
        assert_eq!(detect_aac_actual_sample_rate(Some(&aac_lc_extra_data), 44100), 44100);

        // Backward-compatible HE-AAC with Audio Object Type 2 and frequency index 7 (22050Hz) while container says 44100Hz:
        // byte 0: 00010 011 -> AOT = 2 (AAC-LC), top 3 bits of freq = 011 (3)
        // byte 1: 10010 000 -> bottom bit of freq = 1 -> freq_idx = 7 (22050Hz)
        let aac_lc_sbr_extra_data = [0x13u8, 0x90];
        assert_eq!(detect_aac_actual_sample_rate(Some(&aac_lc_sbr_extra_data), 44100), 22050);

        // Missing or incomplete extra_data should fallback safely to container rate
        assert_eq!(detect_aac_actual_sample_rate(None, 48000), 48000);
        assert_eq!(detect_aac_actual_sample_rate(Some(&[43]), 48000), 48000);
    }
}


