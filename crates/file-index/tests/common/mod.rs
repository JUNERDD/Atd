//! Helpers shared by the integration tests. Every test indexes its own temporary folder; none
//! touches the real home folder.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use file_index::{FileIndex, Hit, IndexOptions, Phase};

pub const EXTENSIONS: &[&str] = &["md", "txt", "ts", "json"];

/// A fake home (real path, so it compares with FSEvents paths) and a separate data folder.
pub struct Fixture {
    _temp: tempfile::TempDir,
    pub home: PathBuf,
    pub data: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let home = base.join("home");
        let data = base.join("data");
        fs::create_dir_all(&home).unwrap();
        Self {
            _temp: temp,
            home,
            data,
        }
    }

    /// Writes a file below home, creating its folders.
    pub fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let path = self.home.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        path
    }

    pub fn options(&self) -> IndexOptions {
        self.options_with(EXTENSIONS)
    }

    pub fn options_with(&self, extensions: &[&str]) -> IndexOptions {
        IndexOptions::home(
            &self.home,
            extensions.iter().map(|ext| ext.to_string()).collect(),
        )
    }

    pub fn open(&self) -> FileIndex {
        FileIndex::open(&self.data, self.options()).unwrap()
    }

    /// Opens, starts and waits for the first walk to finish.
    pub fn ready(&self) -> FileIndex {
        let index = self.open();
        index.start().unwrap();
        wait_for(|| index.status().phase == Phase::Watching, "the first walk");
        index
    }
}

/// Polls until `condition` holds, failing after 15 seconds (FSEvents latency is 0.5 s).
pub fn wait_for(mut condition: impl FnMut() -> bool, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

pub fn names(hits: &[Hit]) -> Vec<String> {
    hits.iter().map(|hit| hit.name.clone()).collect()
}

/// Whether a query for `query` returns a file at `path`.
pub fn finds(index: &FileIndex, query: &str, path: &Path) -> bool {
    index
        .query(query, 100)
        .unwrap()
        .iter()
        .any(|hit| hit.path == path)
}
