use super::{
    evaluate_audio_path, AudioFormatSnapshot, AudioRouteSnapshot, DSPState,
};

fn exact_exclusive_route() -> AudioRouteSnapshot {
    AudioRouteSnapshot {
        active: true,
        engine: "wasapi".to_string(),
        share_mode: "exclusive".to_string(),
        source: AudioFormatSnapshot {
            sample_rate: 96_000,
            channels: 2,
            sample_format: Some("pcm_s24".to_string()),
            bits_per_sample: Some(24),
            valid_bits_per_sample: Some(24),
            channel_mask: Some(3),
        },
        pipeline_sample_format: "pcm_s24".to_string(),
        output: AudioFormatSnapshot {
            sample_rate: 96_000,
            channels: 2,
            sample_format: Some("pcm_s24".to_string()),
            bits_per_sample: Some(24),
            valid_bits_per_sample: Some(24),
            channel_mask: Some(3),
        },
        fallback_reason: None,
        gain_ramp: false,
        volume_bypass_in_bit_perfect: true,
        dither_enabled: false,
        sample_integrity_verified: true,
    }
}

#[test]
fn verifies_only_an_exact_effective_route() {
    let path = evaluate_audio_path(
        &exact_exclusive_route(),
        &DSPState::default(),
        true,
        true,
        1.0,
        0,
    );

    assert!(path.strict_bit_perfect);
    assert!(path.strict_failure_reasons.is_empty());
    assert!(path.active_transforms.is_empty());
    assert_eq!(path.share_mode, "exclusive");
}

#[test]
fn rejects_a_shared_fallback_even_when_bit_perfect_was_requested() {
    let mut route = exact_exclusive_route();
    route.engine = "cpal".to_string();
    route.share_mode = "shared".to_string();
    route.fallback_reason = Some("wasapi_exclusive_unavailable".to_string());

    let path = evaluate_audio_path(
        &route,
        &DSPState::default(),
        true,
        true,
        1.0,
        0,
    );

    assert!(!path.strict_bit_perfect);
    assert!(path.strict_failure_reasons.contains(&"shared_output".to_string()));
    assert_eq!(
        path.fallback_reason.as_deref(),
        Some("wasapi_exclusive_unavailable")
    );
}

#[test]
fn reports_every_transform_that_invalidates_sample_integrity() {
    let mut route = exact_exclusive_route();
    route.output.sample_rate = 48_000;
    route.output.channels = 6;
    route.output.sample_format = Some("pcm_f32".to_string());
    route.output.bits_per_sample = Some(32);
    route.output.valid_bits_per_sample = Some(32);
    route.gain_ramp = true;
    route.volume_bypass_in_bit_perfect = false;
    route.dither_enabled = true;
    route.sample_integrity_verified = false;

    let mut dsp = DSPState::default();
    dsp.enabled = true;
    dsp.crossfade_transition_enabled = true;
    dsp.playback_rate = 1.25;

    let path = evaluate_audio_path(&route, &dsp, true, true, 0.5, 3);

    assert!(!path.strict_bit_perfect);
    for transform in [
        "resampling",
        "playback_rate",
        "channel_mixing",
        "sample_format_conversion",
        "gain_ramp",
        "volume",
        "dither",
        "dsp",
        "crossfade",
    ] {
        assert!(
            path.active_transforms.contains(&transform.to_string()),
            "missing transform: {transform}"
        );
    }
    assert_eq!(path.underruns, 3);
    assert!(path
        .strict_failure_reasons
        .contains(&"underruns_detected".to_string()));
    assert!(path
        .strict_failure_reasons
        .contains(&"sample_integrity_unverified".to_string()));
}

#[test]
fn serializes_the_ipc_contract_with_snake_case_fields() {
    let path = evaluate_audio_path(
        &exact_exclusive_route(),
        &DSPState::default(),
        true,
        true,
        1.0,
        0,
    );

    let value = serde_json::to_value(path).expect("audio path should serialize");
    assert_eq!(value["strict_bit_perfect"], true);
    assert_eq!(value["source"]["sample_rate"], 96_000);
    assert_eq!(value["output"]["valid_bits_per_sample"], 24);
}
