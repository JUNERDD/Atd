//! Measures the P6 acceptance numbers on the real home folder: first-walk time, resident memory,
//! query latency, resume time and index size, plus create-to-searchable latency on a temporary
//! folder. Home is only read; the index goes to the data folder given as the first argument.
//! Prints aggregates only, never paths or file names.
//!
//! `cargo run --release -p file-index --example home_bench -- <empty temp dir>`

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use file_index::{FileIndex, IndexOptions, Phase};

/// The attachable extensions of `attachable-rules.ts` at the time of writing.
const EXTENSIONS: &[&str] = &[
    "txt", "md", "csv", "json", "log", "yaml", "yml", "xml", "html", "css", "ts", "tsx", "js", "py",
];
const QUERIES: &[&str] = &[
    "", "a", "readme", "notes", "index", "config", "test", "package", "todo", "plan", "report",
    "main", "doc", "api", "log", "setup", "data", "claude", "resume", "2026",
];
const WALK_DEADLINE: Duration = Duration::from_secs(540);

fn main() {
    let data = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("usage: home_bench <data dir>"),
    );
    let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
    let extensions: Vec<String> = EXTENSIONS.iter().map(|ext| ext.to_string()).collect();

    let started = Instant::now();
    let index = FileIndex::open(&data, IndexOptions::home(&home, extensions.clone())).unwrap();
    index.start().unwrap();
    while index.status().phase != Phase::Watching && started.elapsed() < WALK_DEADLINE {
        std::thread::sleep(Duration::from_millis(100));
    }
    let status = index.status();
    println!(
        "first walk: {:.1?} complete={} files={}",
        started.elapsed(),
        status.phase == Phase::Watching,
        status.scanned_files
    );
    println!(
        "skipped roots: {} error: {:?}",
        status.skipped_roots.len(),
        status.error.is_some()
    );
    println!(
        "rss after walk: {} MiB (peak {} MiB)",
        rss_mib(),
        peak_rss_mib()
    );

    let mut latencies = Vec::new();
    for _ in 0..20 {
        for query in QUERIES {
            let start = Instant::now();
            let hits = index.query(query, 20).unwrap();
            latencies.push(start.elapsed());
            std::hint::black_box(hits);
        }
    }
    latencies.sort();
    let at = |q: f64| latencies[((latencies.len() - 1) as f64 * q) as usize];
    println!(
        "query latency over {}: p50 {:.2?} p95 {:.2?} max {:.2?}",
        latencies.len(),
        at(0.5),
        at(0.95),
        at(1.0)
    );
    println!("rss after queries: {} MiB", rss_mib());
    index.close().unwrap();
    drop(index);

    let reopened = Instant::now();
    let index = FileIndex::open(&data, IndexOptions::home(&home, extensions.clone())).unwrap();
    index.start().unwrap();
    let hits = index.query("readme", 20).unwrap().len();
    println!(
        "reopen+resume: {:.1?} resumed={} readme hits={hits}",
        reopened.elapsed(),
        index.status().resumed
    );
    index.close().unwrap();
    drop(index);
    println!("index size: {} MiB", dir_size(&data) / (1024 * 1024));

    freshness(&extensions);
}

/// Create-to-searchable and rename-to-searchable latency on a temporary folder.
fn freshness(extensions: &[String]) {
    let temp = std::env::temp_dir().join(format!("file-index-bench-{}", std::process::id()));
    let (home, data) = (temp.join("home"), temp.join("data"));
    std::fs::create_dir_all(&home).unwrap();
    let index = FileIndex::open(&data, IndexOptions::home(&home, extensions.to_vec())).unwrap();
    index.start().unwrap();
    while index.status().phase != Phase::Watching {
        std::thread::sleep(Duration::from_millis(10));
    }
    let home = home.canonicalize().unwrap();
    let created = home.join("fresh-bench-file.md");
    let start = Instant::now();
    std::fs::write(&created, "x").unwrap();
    wait_found(&index, "fresh", &created);
    println!("create -> searchable: {:.0?}", start.elapsed());
    let renamed = home.join("renamed-bench-file.md");
    let start = Instant::now();
    std::fs::rename(&created, &renamed).unwrap();
    wait_found(&index, "renamed", &renamed);
    println!("rename -> searchable: {:.0?}", start.elapsed());
    index.close().unwrap();
    drop(index);
    std::fs::remove_dir_all(&temp).unwrap();
}

fn wait_found(index: &FileIndex, query: &str, path: &Path) {
    while !index
        .query(query, 20)
        .unwrap()
        .iter()
        .any(|hit| hit.path == path)
    {
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn rss_mib() -> u64 {
    let pid = std::process::id().to_string();
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .unwrap_or(0)
        / 1024
}

fn peak_rss_mib() -> u64 {
    // SAFETY: `getrusage` fills the zeroed struct we own.
    let usage = unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
        usage
    };
    // macOS reports bytes.
    usage.ru_maxrss as u64 / (1024 * 1024)
}

fn dir_size(path: &Path) -> u64 {
    std::fs::read_dir(path).map_or(0, |entries| {
        entries
            .flatten()
            .map(|entry| match entry.file_type() {
                Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
                _ => entry.metadata().map_or(0, |meta| meta.len()),
            })
            .sum()
    })
}
