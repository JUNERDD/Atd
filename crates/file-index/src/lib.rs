//! Persistent file-name index of the known-format files under the home folder, kept current with
//! FSEvents. This is the Rust side of the Raycast-style file search planned in
//! `docs/plans/2026-09-29-macos-native-frontend.md` (P6): a first walk of home, then incremental
//! updates, with the last applied event id saved so a restart replays only what it missed.
//!
//! - Scope: `scope.rs`, `exclusions.rs` (the earlier search's rules merged with Raycast's; inside
//!   git work trees, every file the repository's ignore rules keep), ignore files through the
//!   `ignore` crate (`walk.rs`), local internal volumes only (`volume.rs`).
//! - Storage: `store.rs`, a `NameStore` trait whose only implementation wraps minidex, plus the
//!   in-memory `names.rs` list behind it that queries search.
//! - Updates: `fsevents.rs` → `plan.rs` → `reconcile.rs`, driven by `engine.rs` and
//!   `background.rs`.
//! - Queries: `pattern.rs` parses them, `search.rs` scans every name, `fuzzy.rs` scores fuzzy
//!   name matches, `rank.rs` orders the hits (the only ranker file search has), `fold.rs` folds
//!   case, accents, width and separators.

#[cfg(not(target_os = "macos"))]
compile_error!("file-index watches folders with FSEvents and supports macOS only");

mod background;
mod engine;
mod exclusions;
mod extensions;
mod fold;
mod fsevents;
mod fuzzy;
mod names;
mod pattern;
mod plan;
mod query;
mod rank;
mod reconcile;
mod scope;
mod search;
mod state;
mod store;
mod volume;
mod walk;

use std::path::{Path, PathBuf};

pub use engine::FileIndex;
pub use extensions::Extensions;
pub use fold::NameRange;
pub use scope::{ICLOUD_LABEL, RootSpec};

/// What `FileIndex::open` indexes.
#[derive(Debug, Clone)]
pub struct IndexOptions {
    pub roots: Vec<RootSpec>,
    /// Extensions of the formats to index, from the caller's searchable formats (see `Extensions`).
    pub extensions: Vec<String>,
}

impl IndexOptions {
    /// Home and iCloud Drive, the scope the current file search uses.
    pub fn home(home: &Path, extensions: Vec<String>) -> Self {
        Self {
            roots: RootSpec::home(home),
            extensions,
        }
    }
}

/// One search result.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    /// Stable for a path across queries and restarts: FNV-1a 64 of the path bytes, in hex.
    pub id: String,
    /// Real, absolute path. Callers keep it out of any renderer-facing reply.
    pub path: PathBuf,
    pub name: String,
    /// Parent folder as shown to the user: home-relative, or under `iCloud Drive` ('' = home).
    pub location: String,
    /// Rank score; higher is better. Results come sorted, ties already broken.
    pub score: i64,
    /// Epoch milliseconds, read when the query ran.
    pub modified_ms: Option<u64>,
    pub size: Option<u64>,
    /// Where the query matched the name: sorted, non-overlapping UTF-16 ranges into the NFC
    /// name, covering whole characters with their marks. Empty when only the folder matched or
    /// the query was empty.
    pub matches: Vec<NameRange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Opened, `start` not called yet. Queries answer from the saved store.
    Idle,
    /// A walk is running, the first one or a root's rebuild; queries see the files found so far.
    Scanning,
    /// Resumed: the events recorded while the index was closed are being applied, so queries
    /// may still show files as they were then.
    Replaying,
    /// Up to date and following file-system events.
    Watching,
    /// Background work failed (`Status::error` says why): queries answer from the store, which
    /// may be missing changes until the index is opened again, which rebuilds it.
    Failed,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub phase: Phase,
    /// `start` resumed from a saved event id instead of walking every root.
    pub resumed: bool,
    /// Files written by walks since `start`, full or partial.
    pub scanned_files: u64,
    /// Every event up to this id is reflected in the store.
    pub last_event_id: u64,
    /// Roots left out because they are not on a local, internal volume.
    pub skipped_roots: Vec<PathBuf>,
    /// The last background failure, with the phase at `Failed`. The saved state is then marked
    /// incomplete, so the next `open` rebuilds instead of resuming from a store that may have
    /// missed changes.
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid index options: {0}")]
    InvalidOptions(String),
    #[error("index store failed: {0}")]
    Store(String),
    #[error("file-system events failed: {0}")]
    Watch(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("internal error: {0}")]
    Internal(String),
    #[error("the index is closed")]
    Closed,
}

impl From<store::StoreError> for Error {
    fn from(error: store::StoreError) -> Self {
        Error::Store(error.to_string())
    }
}
