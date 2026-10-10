//! The persistent file-name store. `NameStore` is the only surface the rest of the crate sees;
//! `MinidexStore` is its sole implementation and the only code that names a `minidex` type, so a
//! breaking minidex release, a vendored copy or a replacement touches this file alone. It also
//! owns the in-memory `NameList` behind `containing`, kept in step with every write.

use std::fmt;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use minidex::{FilesystemEntry, Index, Kind, SearchOptions, VolumeType};

use crate::names::NameList;

/// One indexed file: its root's key and its stored path, `/` + displayed location + `/` + name.
/// Stored paths are unique across roots (iCloud Drive files start with `/iCloud Drive/`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredFile {
    pub root: String,
    pub rel: String,
    /// Content modification time, whole seconds since the Unix epoch.
    pub modified_secs: u64,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(crate) struct StoreError(String);

/// Persistent, concurrently readable file-name index. Writes are durable once `persist` returns.
pub(crate) trait NameStore: Send + Sync + fmt::Debug {
    /// Inserts files or replaces the entries with the same root and path.
    fn upsert(&self, files: Vec<StoredFile>) -> Result<(), StoreError>;
    fn remove(&self, root: &str, rel: &str) -> Result<(), StoreError>;
    /// Removes `rel` and everything below it; `""` removes the whole root.
    fn remove_tree(&self, root: &str, rel: &str) -> Result<(), StoreError>;
    /// Files whose path words start with the query words, at most `cap`, in no promised order.
    fn candidates(&self, query: &str, cap: usize) -> Result<Vec<StoredFile>, StoreError>;
    /// Files whose name contains the query anywhere (case- and accent-folded), newest first, at
    /// most `cap`. Slower than `candidates`: for mid-word matches when word matches run short.
    fn containing(&self, query: &str, cap: usize) -> Result<Vec<StoredFile>, StoreError>;
    /// Files modified since `since_secs`, at most `cap`.
    fn recent(&self, since_secs: u64, cap: usize) -> Result<Vec<StoredFile>, StoreError>;
    /// Makes every accepted write durable.
    fn persist(&self) -> Result<(), StoreError>;
    /// Moves buffered entries into the compact on-disk form, so memory drops and the next open
    /// maps them instead of replaying a log. Slower than `persist`; for the end of a walk or close.
    fn checkpoint(&self) -> Result<(), StoreError>;
}

/// minidex 0.39.0: FST segments + mmap + write-ahead log, with background flush and compaction.
///
/// Word-prefix matching only: the query `port` finds `port-notes.md` and `reportPort.md` (camel
/// case splits words) but not `report.md`. Paths are stored as displayed locations with the root
/// as minidex's volume, so home's own path words (`Users`, the account name) never match a query.
/// minidex merges results by path alone, which is why stored paths must be unique across roots.
///
/// minidex has no substring search, so every stored path is also held in `names` (about 100 bytes
/// per file), loaded from the index at open and updated after each successful write.
pub(crate) struct MinidexStore {
    index: Index,
    names: RwLock<NameList>,
    dir: PathBuf,
}

impl fmt::Debug for MinidexStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MinidexStore")
            .field("dir", &self.dir)
            .finish()
    }
}

impl MinidexStore {
    /// Opens or creates the store in `dir`, holding minidex's directory lock until dropped, and
    /// waits for any write-ahead log left by an earlier process to be replayed.
    pub fn open(dir: &Path) -> Result<Self, StoreError> {
        std::fs::create_dir_all(dir).map_err(fail)?;
        let index = Index::open(dir).map_err(fail)?;
        index.wait_for_completed_recovery();
        let names = RwLock::new(list_all(&index)?);
        Ok(Self {
            index,
            names,
            dir: dir.to_path_buf(),
        })
    }

    fn names(&self) -> RwLockReadGuard<'_, NameList> {
        self.names
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn names_mut(&self) -> RwLockWriteGuard<'_, NameList> {
        self.names
            .write()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    fn options() -> SearchOptions<'static> {
        SearchOptions {
            kind: Some(Kind::File),
            ..SearchOptions::default()
        }
    }
}

impl NameStore for MinidexStore {
    fn upsert(&self, files: Vec<StoredFile>) -> Result<(), StoreError> {
        let entries = files.iter().map(|file| FilesystemEntry {
            path: PathBuf::from(&file.rel),
            volume: file.root.clone(),
            kind: Kind::File,
            last_modified: file.modified_secs.saturating_mul(MICROS),
            // Access times are not tracked: APFS updates them lazily, so they do not mean "used".
            last_accessed: 0,
            category: 0,
            volume_type: VolumeType::Local,
        });
        self.index.insert_batch(entries, 1024).map_err(fail)?;
        let mut names = self.names_mut();
        for file in files {
            names.insert(file);
        }
        Ok(())
    }

    fn remove(&self, root: &str, rel: &str) -> Result<(), StoreError> {
        // minidex deletes a path across volumes; stored paths are unique across roots.
        self.index.delete(Path::new(rel)).map_err(fail)?;
        self.names_mut().remove(root, rel);
        Ok(())
    }

    fn remove_tree(&self, root: &str, rel: &str) -> Result<(), StoreError> {
        self.index
            .delete_by_volume_name(Some(root), rel)
            .map_err(fail)?;
        self.names_mut().remove_tree(root, rel);
        Ok(())
    }

    fn candidates(&self, query: &str, cap: usize) -> Result<Vec<StoredFile>, StoreError> {
        let results = self
            .index
            .search(query, cap, 0, Self::options())
            .map_err(fail)?;
        Ok(results.into_iter().map(stored).collect())
    }

    fn containing(&self, query: &str, cap: usize) -> Result<Vec<StoredFile>, StoreError> {
        Ok(self.names().containing(query, cap))
    }

    fn recent(&self, since_secs: u64, cap: usize) -> Result<Vec<StoredFile>, StoreError> {
        let results = self
            .index
            .recent_files(since_secs, cap, 0, Self::options())
            .map_err(fail)?;
        Ok(results.into_iter().map(stored).collect())
    }

    fn persist(&self) -> Result<(), StoreError> {
        self.index.sync().map_err(fail)
    }

    fn checkpoint(&self) -> Result<(), StoreError> {
        self.index.sync().map_err(fail)?;
        self.index.flush().map_err(fail)?;
        // Rebuilt after the flush freed minidex's in-memory table: names allocated during a walk
        // sit between that table's allocations and would keep its freed pages resident.
        let mut names = self.names_mut();
        *names = NameList::default();
        *names = list_all(&self.index)?;
        Ok(())
    }
}

/// Every live file in the index: all stored paths start with `/`, so the empty prefix matches
/// them all, prefix tombstones applied. The scan streams entries into the list instead of
/// collecting them first, and with no early stop it always visits every entry.
fn list_all(index: &Index) -> Result<NameList, StoreError> {
    let mut names = NameList::default();
    index
        .for_each_with_prefix(None, "", |entry| {
            if entry.kind == Kind::File {
                names.insert(StoredFile {
                    root: entry.volume,
                    rel: entry.path.to_string_lossy().into_owned(),
                    modified_secs: entry.last_modified / MICROS,
                });
            }
            ControlFlow::Continue(())
        })
        .map_err(fail)?;
    Ok(names)
}

/// minidex timestamps are microseconds: it divides them into seconds for its recency filter and
/// scoring, so seconds passed as-is would read as 1970 and no file would count as recent.
const MICROS: u64 = 1_000_000;

fn stored(result: minidex::SearchResult) -> StoredFile {
    StoredFile {
        root: result.volume,
        rel: result.path.to_string_lossy().into_owned(),
        modified_secs: result.last_modified / MICROS,
    }
}

fn fail(error: impl fmt::Display) -> StoreError {
    StoreError(error.to_string())
}
