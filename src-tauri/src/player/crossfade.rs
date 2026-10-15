use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use tauri::Manager;

use crate::safe_lock;
use super::decoder::kill_current_process;
use super::{DSPState, LOCAL_QUEUE_GENERATION, SOURCE_QUEUE_MODE};

pub struct CrossfadeReservation {
    pub path: Option<String>,
    pub queue: Arc<Mutex<VecDeque<String>>>,
    pub queue_generation: u64,
    pub cancel: Arc<AtomicBool>,
    pub process: Arc<Mutex<Option<std::process::Child>>>,
    pub worker: Option<thread::JoinHandle<()>>,
}

impl CrossfadeReservation {
    pub fn cancel_preparation(&mut self) {
        self.cancel.store(true, Ordering::SeqCst);
        kill_current_process(&self.process);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        kill_current_process(&self.process);
    }
}

impl Drop for CrossfadeReservation {
    fn drop(&mut self) {
        self.cancel_preparation();
        let mut queue = safe_lock(&self.queue);
        if should_restore_fade_reservation(self.queue_generation, LOCAL_QUEUE_GENERATION.load(Ordering::SeqCst), SOURCE_QUEUE_MODE.load(Ordering::SeqCst)) {
            if let Some(path) = self.path.take() { queue.push_front(path); }
        }
    }
}

pub fn should_restore_fade_reservation(reserved_generation: u64, current_generation: u64, source_mode: bool) -> bool {
    !source_mode && reserved_generation == current_generation
}

pub fn cancel_crossfade_handoff(reservation: &mut Option<CrossfadeReservation>, handoff: &mut bool, next_track: &mut Option<(String, f64, Option<String>)>) {
    *handoff = false;
    *next_track = None;
    drop(reservation.take());
}

pub fn crossfade_trigger_position(dsp: &DSPState, duration: f64, bit_perfect: bool, source_mode: bool) -> Option<f64> {
    if !dsp.crossfade_transition_enabled || bit_perfect || source_mode
        || dsp.crossfade_transition_duration <= 0.0 || duration <= dsp.crossfade_transition_duration as f64 {
        None
    } else {
        Some(duration - dsp.crossfade_transition_duration as f64)
    }
}

#[allow(dead_code)]
pub fn mix_crossfade_frames(
    current: &mut [Vec<f32>], next: &mut [VecDeque<f32>],
    start_frame: usize, fade_frames: usize,
) -> usize {
    mix_crossfade_frames_scaled(current, next, start_frame, fade_frames, 1.0, 1.0)
}

pub fn mix_crossfade_frames_scaled(
    current: &mut [Vec<f32>], next: &mut [VecDeque<f32>],
    start_frame: usize, fade_frames: usize,
    out_scale: f32, in_scale: f32,
) -> usize {
    let frames = current[0].len().min(next[0].len()).min(fade_frames.saturating_sub(start_frame));
    for channel in next.iter().take(current.len()) {
        debug_assert!(channel.len() >= frames);
    }
    for i in 0..frames {
        let progress = ((start_frame + i) as f32 / fade_frames.max(1) as f32).clamp(0.0, 1.0);
        let out_gain = (1.0 - progress) * out_scale;
        let in_gain = progress * in_scale;
        for (ch, samples) in current.iter_mut().enumerate() {
            let next_sample = next.get_mut(ch).and_then(VecDeque::pop_front).unwrap_or(0.0);
            samples[i] = samples[i] * out_gain + next_sample * in_gain;
        }
    }
    frames
}

pub fn get_track_perceived_gain_db(app_handle: &tauri::AppHandle, path: &str) -> Option<f32> {
    let app_state = app_handle.try_state::<crate::AppState>()?;
    let conn = safe_lock(&app_state.db);
    let has_sonic = crate::db::column_exists(&conn, "tracks", "sonic_profile");
    let query = if has_sonic {
        "SELECT replaygain_gain, sonic_profile FROM tracks WHERE path = ?1"
    } else {
        "SELECT replaygain_gain, NULL FROM tracks WHERE path = ?1"
    };
    let mut stmt = conn.prepare(query).ok()?;
    stmt.query_row(rusqlite::params![path], |row| {
        let rg: Option<f64> = row.get(0).ok().flatten();
        let sp_str: Option<String> = row.get(1).ok().flatten();
        let mut gain = rg.filter(|g| g.is_finite() && g.abs() > 0.0001);
        if gain.is_none() {
            if let Some(json) = sp_str {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    if let Some(lufs_gain) = v.get("lufs_gain_db").and_then(|x| x.as_f64()).filter(|g| g.is_finite()) {
                        gain = Some(lufs_gain);
                    } else if let Some(lufs) = v.get("integrated_lufs").and_then(|x| x.as_f64()).filter(|l| l.is_finite() && *l > -70.0) {
                        gain = Some((-14.0 - lufs).clamp(-12.0, 12.0));
                    }
                }
            }
        }
        Ok(gain.map(|g| g as f32))
    }).ok().flatten()
}
