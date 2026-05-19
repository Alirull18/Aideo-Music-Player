import re
import sys

def main():
    path = r'c:\Users\Alirul\Aideo-Music-Player\src-tauri\src\player.rs'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add ActiveStream
    content = content.replace(
        "use tauri::Emitter;\n",
        "use tauri::Emitter;\n\npub enum ActiveStream {\n    Cpal(cpal::Stream),\n    Wasapi(crate::wasapi_engine::WasapiStream),\n}\n"
    )

    # 2. stream_info Option type
    content = content.replace(
        "let mut stream_info: Option<(cpal::Stream, cpal::StreamConfig)> = None;",
        "let mut stream_info: Option<(ActiveStream, cpal::StreamConfig)> = None;"
    )

    # 3. Insert our WASAPI engine before the for loop
    old_loop_start = """    for (config, sample_format) in configs_to_try {
        let paused_cb = Arc::clone(&stream_paused);"""
    
    new_wasapi_block = """    if request_exclusive && !device_display_name.starts_with("[ASIO]") {
        if let Some((config, _)) = configs_to_try.first() {
            println!("[player] AUDIOPHILE: Requesting TRUE WASAPI EXCLUSIVE hardware access...");
            let rate = config.sample_rate.0;
            let channels = config.channels;
            let max_ring = rate as usize * channels as usize;
            let rb = RingBuffer::<f32>::new(max_ring);
            let (prod, mut cons) = rb.split();
            let paused_cb = Arc::clone(&stream_paused);
            let volume_cb = Arc::clone(&stream_volume);
            let flush_cb = Arc::clone(&flush_signal);
            let actual_dev_name = if device_display_name.starts_with("[WASAPI] ") {
                device_display_name.trim_start_matches("[WASAPI] ").to_string()
            } else {
                device_display_name.clone()
            };
            if let Ok(wasapi_stream) = crate::wasapi_engine::start_exclusive_stream(
                &actual_dev_name, rate, channels,
                move |data: &mut [f32]| {
                    if paused_cb.load(std::sync::atomic::Ordering::Relaxed) { data.fill(0.0); return; }
                    if flush_cb.swap(false, std::sync::atomic::Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                    let vol = f32::from_bits(volume_cb.load(std::sync::atomic::Ordering::Relaxed));
                    let mut buf = vec![0.0; data.len()];
                    let n = cons.pop_slice(&mut buf);
                    for i in 0..n { data[i] = buf[i] * vol; }
                    if n < data.len() { data[n..].fill(0.0); }
                }
            ) {
                println!("[player] Successfully locked TRUE WASAPI Exclusive Mode!");
                stream_info = Some((ActiveStream::Wasapi(wasapi_stream), config.clone()));
                prod_opt = Some(prod);
            } else {
                println!("[player] TRUE WASAPI Exclusive Mode failed. Falling back to CPAL Shared Mode.");
            }
        }
    }

    if stream_info.is_none() {
    for (config, sample_format) in configs_to_try {
        let paused_cb = Arc::clone(&stream_paused);"""

    content = content.replace(old_loop_start, new_wasapi_block)

    # 4. Replace `stream_info = Some((s, config));` with `stream_info = Some((ActiveStream::Cpal(s), config));`
    # We must be careful because there are multiple matches
    content = content.replace(
        "stream_info = Some((s, config));",
        "stream_info = Some((ActiveStream::Cpal(s), config));"
    )
    
    # 5. Same for `stream_info = Some((s, config_inner));` if any
    content = content.replace(
        "stream_info = Some((s, config_inner));",
        "stream_info = Some((ActiveStream::Cpal(s), config_inner));"
    )
    
    # 6. We need to add `}` after the first loop ends
    # The first loop ends at:
    #             println!("[player] Trying next config...");
    #         }
    #     }
    # 
    #     if stream_info.is_none() {
    first_loop_end = """            println!("[player] Trying next config...");
        }
    }

    if stream_info.is_none() {"""
    
    first_loop_end_replacement = """            println!("[player] Trying next config...");
        }
    }
    }

    if stream_info.is_none() {"""

    content = content.replace(first_loop_end, first_loop_end_replacement)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
