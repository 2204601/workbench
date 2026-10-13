//! The sampling loop: a reading every second or so on its own thread, into
//! the tray and, while it is open, the popup.

use std::{
    collections::VecDeque,
    sync::{atomic::Ordering, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    popup,
    sampler::{Drive, Processes, Sample, Sampler, SystemInfo},
    settings, tray,
};

/// Readings kept for the popup's graphs.
pub const HISTORY: usize = 120;

/// While the popup is open, the drives' free space is read again every this
/// many readings.
const DRIVES_EVERY: u64 = 10;

pub struct Monitor {
    sampler: Sampler,
    history: VecDeque<Sample>,
    info: SystemInfo,
}

/// Everything the popup shows when it opens.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub info: SystemInfo,
    pub history: Vec<Sample>,
    pub drives: Vec<Drive>,
    pub processes: Processes,
    pub interval_secs: u64,
    pub version: String,
}

/// One reading, sent to the popup while it is open.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Update {
    sample: Sample,
    processes: Processes,
    /// Only every [`DRIVES_EVERY`] readings.
    drives: Option<Vec<Drive>>,
}

pub struct State(pub Mutex<Monitor>);

impl Monitor {
    pub fn new() -> Self {
        let sampler = Sampler::new();
        let info = sampler.info();
        Self { sampler, history: VecDeque::with_capacity(HISTORY), info }
    }

    fn push(&mut self, sample: Sample) {
        if self.history.len() == HISTORY {
            self.history.pop_front();
        }
        self.history.push_back(sample);
    }

    pub fn snapshot(&mut self, interval_secs: u64, version: String) -> Snapshot {
        Snapshot {
            info: self.info.clone(),
            history: self.history.iter().cloned().collect(),
            drives: self.sampler.drives(),
            // The CPU figures need a reading before this one; they fill in
            // with the next update.
            processes: self.sampler.processes(),
            interval_secs,
            version,
        }
    }
}

/// Starts the loop. Each reading goes to the tray; while the popup is open,
/// it also goes there with the busiest apps.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut tick: u64 = 0;
        loop {
            let started = Instant::now();
            let interval = app.state::<settings::Store>().get().interval_secs;
            let open = popup::OPEN.load(Ordering::SeqCst);

            let (sample, update) = {
                let state = app.state::<State>();
                let mut monitor = state.0.lock().unwrap();
                let sample = monitor.sampler.sample();
                monitor.push(sample.clone());
                let update = open.then(|| Update {
                    sample: sample.clone(),
                    processes: monitor.sampler.processes(),
                    drives: tick.is_multiple_of(DRIVES_EVERY).then(|| monitor.sampler.drives()),
                });
                (sample, update)
            };

            tray::show_sample(&app, &sample);
            if let Some(update) = update {
                let _ = app.emit_to(popup::LABEL, "sample", update);
            }

            tick += 1;
            thread::sleep(Duration::from_secs(interval).saturating_sub(started.elapsed()));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_the_latest() {
        let mut monitor = Monitor::new();
        for at in 0..(HISTORY as u64 + 5) {
            monitor.push(Sample { at, ..Sample::default() });
        }
        assert_eq!(monitor.history.len(), HISTORY);
        assert_eq!(monitor.history.front().unwrap().at, 5);
        assert_eq!(monitor.history.back().unwrap().at, HISTORY as u64 + 4);
    }
}
