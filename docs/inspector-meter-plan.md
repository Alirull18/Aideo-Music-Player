# Inspector metering plan

Measure application output sample peak after DSP and volume. Headroom is the distance to 0 dBFS, not dynamic range, true peak, or a DAC measurement. Preserve samples and existing inspector styles.

1. Add a lock-free peak accumulator beside the effective audio path. It scans output samples only during an inspector lease, expires if polling stops, clears between sessions/tracks, and reports silence separately from unavailable data. Test disabled scanning, interval maximum, silence, invalid samples, and expiry.
2. Feed all six output callbacks (exclusive WASAPI, CPAL f32/i16/i32, and emergency f32/i16). Add one Tauri command to enable/renew, read, and disable the meter. Convert to dBFS outside the callback.
3. Share a polling hook between the track inspector and signal-path inspector. Start with the first open inspector, stop with the last close/unmount, serialize IPC so late replies cannot reactivate measurement, and poll at 250 ms without overlapping requests.
4. Render Peak and Headroom with units and silence/unavailable states. Test open/close, simultaneous inspectors, late IPC replies, errors, and measured output.
5. Run TypeScript, all frontend tests, Cargo check, Cargo tests, and scoped diff checks. Hardware listening and verification of the installed build remain separate from source tests.

## Execution result

Implemented in both inspectors. The backend scans samples only during the shared inspector lease; normal closing disables it, and loss of polling expires it after 1.5 seconds. Output samples are read without modification.

Verified on 2026-10-02: TypeScript passed; 123 frontend test files / 1,286 tests passed; Cargo check passed; 400 Rust tests passed with 5 ignored; scoped whitespace checks passed. Full suites were rerun with broader local access after sandbox filesystem failures. Hardware playback and the installed desktop build were not verified.

## Interactive UI follow-up

Added an animated output meter, a held-peak marker, Reset peak, text warnings for low headroom and full scale, and native expandable explanations in both inspectors. Peak hold lasts for the open inspector session. The backend and its open-inspector measurement gate are unchanged.

Design follows the existing dark studio interface: ENERGY 2 / RHYTHM 2 / MOTION 1. Motion communicates measured level changes; reduced-motion mode removes interpolation. Meter colors communicate level thresholds, and the marker has a dark edge for contrast against the fill.

Verified on 2026-10-02: TypeScript and Cargo check passed; 125 frontend files / 1,300 tests passed; 409 Rust tests passed with 5 ignored. Controlled browser preview verified peak hold, keyboard reset, expandable help, overload/unavailable states, and a 238px-wide meter with no page overflow. Text and control colors exceeded 4.5:1 on the panel background. Temporary preview files and server were removed; unrelated concurrent edits were preserved. Whitespace checks passed for the meter component, tests, and owned CSS lines; the shared stylesheet has an unrelated trailing blank line.
