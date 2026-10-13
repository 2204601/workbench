//! Reads CPU, memory, disk and network usage from the OS (sysinfo), and the
//! apps that use the most CPU and memory.
//!
//! Disk and network speeds are worked out here from the running byte
//! counters rather than from sysinfo's "since the last refresh" numbers, so
//! that a drive or network adapter that shows up later doesn't count
//! everything it has moved since boot as one second's worth.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sysinfo::{
    CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, ProcessesToUpdate, System,
    UpdateKind,
};

/// How many apps each list in the popup shows.
const TOP_APPS: usize = 5;

/// One reading of everything the tray and the popup's graphs show.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    /// 0–100, all cores together.
    pub cpu: f32,
    /// 0–100 for each logical core.
    pub cores: Vec<f32>,
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    /// Bytes per second, all drives together.
    pub disk_read: u64,
    pub disk_write: u64,
    /// Bytes per second, all network adapters together.
    pub net_down: u64,
    pub net_up: u64,
}

impl Sample {
    pub fn mem_percent(&self) -> f32 {
        percent(self.mem_used, self.mem_total)
    }
}

pub fn percent(part: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        (part as f64 * 100.0 / total as f64) as f32
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "Windows (C:)", "Macintosh HD".
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    pub removable: bool,
}

/// Everything one app's processes use together (a browser runs as dozens).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub name: String,
    /// 0–100 of the whole CPU, as Task Manager shows it.
    pub cpu: f32,
    pub memory: u64,
    /// How many processes it runs as.
    pub count: u32,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Processes {
    pub by_cpu: Vec<AppUsage>,
    pub by_memory: Vec<AppUsage>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub cpu_brand: String,
    pub logical_cores: usize,
    pub physical_cores: Option<usize>,
    pub os: String,
    pub host: String,
}

pub struct Sampler {
    sys: System,
    networks: Networks,
    disks: Disks,
    last: Instant,
    disk_counters: HashMap<String, (u64, u64)>,
    net_counters: HashMap<String, (u64, u64)>,
}

impl Sampler {
    pub fn new() -> Self {
        let mut sys = System::new();
        // CPU usage is the change between two readings; this is the first.
        sys.refresh_cpu_usage();
        sys.refresh_memory_specifics(MemoryRefreshKind::everything());
        let mut sampler = Self {
            sys,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list_specifics(DiskRefreshKind::nothing().with_storage().with_io_usage()),
            last: Instant::now(),
            disk_counters: HashMap::new(),
            net_counters: HashMap::new(),
        };
        // Starting points for the speeds.
        sampler.disk_counters = rates(&HashMap::new(), sampler.disk_totals(), 1.0).1;
        sampler.net_counters = rates(&HashMap::new(), sampler.net_totals(), 1.0).1;
        sampler
    }

    pub fn info(&self) -> SystemInfo {
        let cpus = self.sys.cpus();
        SystemInfo {
            cpu_brand: cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            logical_cores: cpus.len(),
            physical_cores: System::physical_core_count(),
            os: System::long_os_version().unwrap_or_default(),
            host: System::host_name().unwrap_or_default(),
        }
    }

    /// Takes a reading. The speeds are averaged over the time since the
    /// previous one.
    pub fn sample(&mut self) -> Sample {
        let secs = self.last.elapsed().as_secs_f64().max(0.001);
        self.last = Instant::now();

        self.sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_cpu_usage());
        self.sys.refresh_memory_specifics(MemoryRefreshKind::everything());
        for disk in self.disks.list_mut() {
            disk.refresh_specifics(DiskRefreshKind::nothing().with_io_usage());
        }
        // `true`: adapters that went away are dropped, new ones are added.
        self.networks.refresh(true);

        let ((disk_read, disk_write), disk_counters) = rates(&self.disk_counters, self.disk_totals(), secs);
        let ((net_down, net_up), net_counters) = rates(&self.net_counters, self.net_totals(), secs);
        self.disk_counters = disk_counters;
        self.net_counters = net_counters;

        Sample {
            at: SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64),
            cpu: self.sys.global_cpu_usage().clamp(0.0, 100.0),
            cores: self.sys.cpus().iter().map(|c| c.cpu_usage().clamp(0.0, 100.0)).collect(),
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            swap_used: self.sys.used_swap(),
            swap_total: self.sys.total_swap(),
            disk_read,
            disk_write,
            net_down,
            net_up,
        }
    }

    /// The apps using the most CPU and memory. Costs more than a sample, so
    /// it is only read while the popup is open. The CPU figures are the
    /// change since the previous call: the first call after a while reads
    /// them as 0.
    pub fn processes(&mut self) -> Processes {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory().with_exe(UpdateKind::OnlyIfNotSet),
        );
        let cores = self.sys.cpus().len().max(1);
        let procs = self
            .sys
            .processes()
            .iter()
            // Windows' "System Idle Process" counts the free CPU as its own.
            .filter(|(pid, _)| pid.as_u32() != 0)
            .map(|(_, p)| (app_name(&p.name().to_string_lossy(), p.exe()), p.cpu_usage(), p.memory()));
        top_apps(procs, cores, TOP_APPS)
    }

    /// Fixed and removable drives with their free space, read fresh.
    pub fn drives(&mut self) -> Vec<Drive> {
        // `true`: unplugged drives are dropped, new ones are added.
        self.disks.refresh_specifics(true, DiskRefreshKind::nothing().with_storage().with_io_usage());
        let mut drives: Vec<Drive> = self
            .disks
            .list()
            .iter()
            .filter(|d| shows_drive(&d.mount_point().to_string_lossy(), d.total_space()))
            .map(|d| {
                let mount = d.mount_point().to_string_lossy().to_string();
                Drive {
                    name: drive_name(&d.name().to_string_lossy(), &mount),
                    mount,
                    total: d.total_space(),
                    available: d.available_space(),
                    removable: d.is_removable(),
                }
            })
            .collect();
        drives.sort_by(|a, b| a.mount.cmp(&b.mount));
        // APFS volumes in one container are listed once each, with the same space.
        drives.dedup_by(|a, b| a.name == b.name && a.total == b.total && a.available == b.available);
        drives
    }

    fn disk_totals(&self) -> Vec<(String, u64, u64)> {
        self.disks
            .list()
            .iter()
            .map(|d| {
                let usage = d.usage();
                (d.mount_point().to_string_lossy().to_string(), usage.total_read_bytes, usage.total_written_bytes)
            })
            .collect()
    }

    fn net_totals(&self) -> Vec<(String, u64, u64)> {
        self.networks
            .iter()
            .filter(|(name, _)| counts_network(name))
            .map(|(name, data)| (name.clone(), data.total_received(), data.total_transmitted()))
            .collect()
    }
}

/// Bytes per second for two running counters per device (read / written,
/// received / sent), and the counters to compare the next reading with.
///
/// A device seen for the first time counts as 0, and so does one whose
/// counters went backwards (reset, or a different device under the same
/// name). Devices whose counters are exactly the same are one device listed
/// twice (APFS volumes on one disk report the disk's numbers) and count once.
fn rates(
    previous: &HashMap<String, (u64, u64)>,
    now: Vec<(String, u64, u64)>,
    secs: f64,
) -> ((u64, u64), HashMap<String, (u64, u64)>) {
    let mut seen = HashSet::new();
    let (mut a, mut b) = (0u64, 0u64);
    for (key, x, y) in &now {
        if !seen.insert((*x, *y)) {
            continue;
        }
        if let Some(&(px, py)) = previous.get(key) {
            if *x >= px && *y >= py {
                a += x - px;
                b += y - py;
            }
        }
    }
    let per_sec = |n: u64| (n as f64 / secs).round() as u64;
    let counters = now.into_iter().map(|(key, x, y)| (key, (x, y))).collect();
    ((per_sec(a), per_sec(b)), counters)
}

/// Whether an adapter's traffic is counted. Loopback never leaves the PC, and
/// VPN tunnels and virtual bridges carry traffic that is also counted on the
/// real adapter underneath. (On Windows, sysinfo already lists only the
/// hardware adapters.)
fn counts_network(name: &str) -> bool {
    const VIRTUAL: &[&str] = &[
        "lo", "utun", "bridge", "awdl", "llw", "anpi", "gif", "stf", "ap1", "vmnet", "vboxnet", "docker", "veth",
        "virbr",
    ];
    let name = name.to_ascii_lowercase();
    !VIRTUAL.iter().any(|prefix| name.starts_with(prefix)) && !name.contains("loopback")
}

/// The name an app's processes are grouped under: the .app bundle on macOS
/// ("Google Chrome Helper (Renderer)" belongs to "Google Chrome"), the
/// program name without ".exe" on Windows.
fn app_name(process: &str, exe: Option<&Path>) -> String {
    if let Some(bundle) = exe.and_then(outermost_app_bundle) {
        return bundle;
    }
    let name = process.trim();
    match name.len().checked_sub(4) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(".exe") => name[..cut].to_string(),
        _ => name.to_string(),
    }
}

fn outermost_app_bundle(exe: &Path) -> Option<String> {
    exe.components().find_map(|c| {
        let part = c.as_os_str().to_str()?;
        part.strip_suffix(".app").filter(|s| !s.is_empty()).map(str::to_string)
    })
}

/// Adds up processes per app and keeps the top `n` by CPU and by memory.
/// `cpu` is per core (sysinfo), so a busy process can read over 100.
fn top_apps(procs: impl Iterator<Item = (String, f32, u64)>, cores: usize, n: usize) -> Processes {
    let mut apps: HashMap<String, AppUsage> = HashMap::new();
    for (name, cpu, memory) in procs {
        let app = apps.entry(name.clone()).or_insert(AppUsage { name, cpu: 0.0, memory: 0, count: 0 });
        app.cpu += cpu / cores as f32;
        app.memory += memory;
        app.count += 1;
    }
    let mut apps: Vec<AppUsage> = apps.into_values().collect();
    for app in &mut apps {
        app.cpu = app.cpu.clamp(0.0, 100.0);
    }

    apps.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then_with(|| a.name.cmp(&b.name)));
    // Under 0.05% rounds to "0.0%" and says nothing.
    let by_cpu = apps.iter().filter(|a| a.cpu >= 0.05).take(n).cloned().collect();
    apps.sort_by(|a, b| b.memory.cmp(&a.memory).then_with(|| a.name.cmp(&b.name)));
    let by_memory = apps.into_iter().filter(|a| a.memory > 0).take(n).collect();
    Processes { by_cpu, by_memory }
}

/// Whether a mounted volume is one people think of as a drive. macOS mounts
/// its own system volumes (VM, Preboot, Update…) under /System/Volumes, and
/// Linux has many small system mounts.
fn shows_drive(mount: &str, total: u64) -> bool {
    const SYSTEM: &[&str] =
        &["/System/Volumes/", "/private/var/vm", "/boot", "/snap/", "/run", "/dev", "/proc", "/sys"];
    total > 0 && !SYSTEM.iter().any(|prefix| mount.starts_with(prefix))
}

/// "Windows (C:)" or "C:" on Windows, the volume's own name elsewhere.
fn drive_name(label: &str, mount: &str) -> String {
    let label = label.trim();
    let letter = mount.trim_end_matches(['\\', '/']);
    let is_letter = letter.len() == 2 && letter.ends_with(':');
    match (is_letter, label.is_empty()) {
        (true, true) => letter.to_string(),
        (true, false) => format!("{label} ({letter})"),
        (false, false) if !label.starts_with("/dev/") => label.to_string(),
        _ => mount.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn counters(list: &[(&str, u64, u64)]) -> Vec<(String, u64, u64)> {
        list.iter().map(|(k, a, b)| (k.to_string(), *a, *b)).collect()
    }

    #[test]
    fn rates_are_the_change_per_second() {
        let (_, before) = rates(&HashMap::new(), counters(&[("C:\\", 1000, 500), ("D:\\", 0, 0)]), 1.0);
        let ((read, write), _) = rates(&before, counters(&[("C:\\", 3000, 900), ("D:\\", 1000, 100)]), 2.0);
        assert_eq!((read, write), (1500, 250));
    }

    #[test]
    fn a_new_device_starts_at_zero() {
        let (_, before) = rates(&HashMap::new(), counters(&[("en0", 100, 100)]), 1.0);
        // A USB drive plugged in with a long history of its own.
        let ((down, up), after) = rates(&before, counters(&[("en0", 300, 100), ("en5", 9_000_000, 9_000_000)]), 1.0);
        assert_eq!((down, up), (200, 0));
        assert!(after.contains_key("en5"));
        let ((down, _), _) = rates(&after, counters(&[("en0", 300, 100), ("en5", 9_000_100, 9_000_000)]), 1.0);
        assert_eq!(down, 100);
    }

    #[test]
    fn a_reset_counter_counts_as_zero() {
        let (_, before) = rates(&HashMap::new(), counters(&[("en0", 5000, 5000)]), 1.0);
        let ((down, up), _) = rates(&before, counters(&[("en0", 10, 10)]), 1.0);
        assert_eq!((down, up), (0, 0));
    }

    #[test]
    fn the_same_counters_twice_count_once() {
        let first = counters(&[("/", 1000, 1000), ("/System/Volumes/Data", 1000, 1000)]);
        let (_, before) = rates(&HashMap::new(), first, 1.0);
        let ((read, write), _) =
            rates(&before, counters(&[("/", 2000, 1500), ("/System/Volumes/Data", 2000, 1500)]), 1.0);
        assert_eq!((read, write), (1000, 500));
    }

    #[test]
    fn virtual_adapters_are_not_counted() {
        for name in ["lo", "lo0", "utun3", "bridge100", "awdl0", "Loopback Pseudo-Interface 1", "docker0"] {
            assert!(!counts_network(name), "{name}");
        }
        for name in ["en0", "Wi-Fi", "イーサネット", "eth0", "wlan0"] {
            assert!(counts_network(name), "{name}");
        }
    }

    #[test]
    fn processes_are_grouped_by_app() {
        assert_eq!(app_name("chrome.exe", None), "chrome");
        assert_eq!(app_name("EXCEL.EXE", None), "EXCEL");
        assert_eq!(app_name("kernel_task", None), "kernel_task");
        assert_eq!(app_name("exe", None), "exe");
        let helper = PathBuf::from(
            "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)",
        );
        assert_eq!(app_name("Google Chrome Helper (Renderer)", Some(&helper)), "Google Chrome");
        let tool = PathBuf::from("/usr/bin/ssh");
        assert_eq!(app_name("ssh", Some(&tool)), "ssh");
    }

    #[test]
    fn top_apps_add_up_processes_and_rank_them() {
        let procs = vec![
            ("chrome".to_string(), 40.0, 300),
            ("chrome".to_string(), 20.0, 200),
            ("Teams".to_string(), 10.0, 900),
            ("idle".to_string(), 0.0, 0),
            ("busy".to_string(), 300.0, 10),
        ];
        let top = top_apps(procs.into_iter(), 4, 2);
        assert_eq!(top.by_cpu.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["busy", "chrome"]);
        assert_eq!(top.by_cpu[0].cpu, 75.0);
        assert_eq!(top.by_cpu[1].cpu, 15.0);
        assert_eq!(top.by_cpu[1].count, 2);
        assert_eq!(top.by_memory.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Teams", "chrome"]);
        assert_eq!(top.by_memory[1].memory, 500);
    }

    #[test]
    fn idle_apps_are_left_out_of_the_cpu_list() {
        let top = top_apps([("a".to_string(), 0.01, 10)].into_iter(), 8, 5);
        assert!(top.by_cpu.is_empty());
        assert_eq!(top.by_memory.len(), 1);
    }

    #[test]
    fn system_volumes_are_not_drives() {
        assert!(shows_drive("C:\\", 500));
        assert!(shows_drive("/", 500));
        assert!(shows_drive("/Volumes/USB", 500));
        assert!(!shows_drive("/System/Volumes/VM", 500));
        assert!(!shows_drive("/boot/efi", 500));
        assert!(!shows_drive("D:\\", 0));
    }

    #[test]
    fn drive_names() {
        assert_eq!(drive_name("Windows", "C:\\"), "Windows (C:)");
        assert_eq!(drive_name("", "D:\\"), "D:");
        assert_eq!(drive_name("Macintosh HD", "/"), "Macintosh HD");
        assert_eq!(drive_name("/dev/sda1", "/home"), "/home");
        assert_eq!(drive_name("", "/mnt/data"), "/mnt/data");
    }

    #[test]
    fn a_real_sample_is_in_range() {
        let mut sampler = Sampler::new();
        let sample = sampler.sample();
        assert!((0.0..=100.0).contains(&sample.cpu));
        assert!(sample.mem_total > 0);
        assert!(sample.mem_used <= sample.mem_total);
        assert!(!sample.cores.is_empty());
        assert!(sampler.info().logical_cores > 0);
        let _ = sampler.processes();
        let _ = sampler.drives();
    }
}
