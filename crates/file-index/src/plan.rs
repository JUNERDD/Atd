//! Turns a batch of file-system events into the least work that brings the index up to date.
//! Pure, so it is tested without FSEvents; `reconcile` carries the plan out.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

/// FSEvents event flags (`FSEventStreamEventFlags`); `fsevents.rs` asserts they match the SDK.
pub(crate) mod flags {
    pub const MUST_SCAN_SUB_DIRS: u32 = 0x0000_0001;
    pub const EVENT_IDS_WRAPPED: u32 = 0x0000_0008;
    pub const HISTORY_DONE: u32 = 0x0000_0010;
    pub const ROOT_CHANGED: u32 = 0x0000_0020;
    pub const MOUNT: u32 = 0x0000_0040;
    pub const UNMOUNT: u32 = 0x0000_0080;
    pub const ITEM_CREATED: u32 = 0x0000_0100;
    pub const ITEM_REMOVED: u32 = 0x0000_0200;
    pub const ITEM_RENAMED: u32 = 0x0000_0800;
    pub const ITEM_IS_DIR: u32 = 0x0002_0000;
}

/// One event as FSEvents delivered it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawEvent {
    pub path: PathBuf,
    pub flags: u32,
    pub id: u64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    /// Events were lost for every root (ids wrapped, or a root moved): rebuild everything.
    pub rescan_all: bool,
    /// Folders to rebuild with everything below them, none nested inside another.
    pub subtrees: Vec<PathBuf>,
    /// Changed file paths grouped by parent folder, outside every subtree.
    pub files: BTreeMap<PathBuf, BTreeSet<PathBuf>>,
    /// The newest event id in the batch.
    pub last_id: Option<u64>,
    /// The replay of events recorded before the stream started has finished.
    pub history_done: bool,
}

pub(crate) fn plan(events: &[RawEvent]) -> Plan {
    use flags::*;
    let mut plan = Plan::default();
    let mut subtrees = BTreeSet::new();
    for event in events {
        plan.last_id = plan.last_id.max(Some(event.id));
        let flags = event.flags;
        if flags & HISTORY_DONE != 0 {
            plan.history_done = true;
            continue;
        }
        if flags & (EVENT_IDS_WRAPPED | ROOT_CHANGED) != 0 {
            plan.rescan_all = true;
            continue;
        }
        if flags & (MOUNT | UNMOUNT) != 0 {
            // The walker never crosses into another volume.
            continue;
        }
        let structural = ITEM_CREATED | ITEM_REMOVED | ITEM_RENAMED;
        if flags & MUST_SCAN_SUB_DIRS != 0 || flags == 0 {
            // Coalesced or dropped events: FSEvents only knows that something below changed.
            subtrees.insert(event.path.clone());
        } else if flags & ITEM_IS_DIR != 0 {
            // A folder appearing, vanishing or moving changes every file below it; other folder
            // events (metadata, xattrs) change no file name.
            if flags & structural != 0 {
                subtrees.insert(event.path.clone());
            }
        } else if let Some(parent) = event.path.parent() {
            plan.files
                .entry(parent.to_path_buf())
                .or_default()
                .insert(event.path.clone());
        }
    }
    if plan.rescan_all {
        plan.files.clear();
        return plan;
    }
    // Sorted order puts a folder before everything below it.
    for subtree in subtrees {
        if !plan.subtrees.iter().any(|kept| subtree.starts_with(kept)) {
            plan.subtrees.push(subtree);
        }
    }
    plan.files.retain(|folder, _| {
        !plan
            .subtrees
            .iter()
            .any(|subtree| folder.starts_with(subtree))
    });
    plan
}

#[cfg(test)]
mod tests {
    use super::flags::*;
    use super::*;

    const FILE: u32 = 0x0001_0000;

    fn event(path: &str, flags: u32, id: u64) -> RawEvent {
        RawEvent {
            path: PathBuf::from(path),
            flags,
            id,
        }
    }

    #[test]
    fn groups_file_events_by_folder() {
        let plan = plan(&[
            event("/h/a/one.md", ITEM_CREATED | FILE, 5),
            event("/h/a/two.md", ITEM_REMOVED | FILE, 7),
            event("/h/b/three.md", ITEM_RENAMED | FILE, 6),
        ]);
        assert_eq!(plan.last_id, Some(7));
        assert!(plan.subtrees.is_empty());
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.files[&PathBuf::from("/h/a")].len(), 2);
    }

    #[test]
    fn folder_changes_become_subtrees_that_absorb_nested_work() {
        let plan = plan(&[
            event("/h/a/b", ITEM_RENAMED | ITEM_IS_DIR, 1),
            event("/h/a", ITEM_CREATED | ITEM_IS_DIR, 2),
            event("/h/a/b/c.md", ITEM_CREATED | FILE, 3),
            event("/h/z", 0x0000_0400 | ITEM_IS_DIR, 4),
            event("/h/y", MUST_SCAN_SUB_DIRS, 5),
            event("/h/ab/d.md", ITEM_CREATED | FILE, 6),
        ]);
        assert_eq!(
            plan.subtrees,
            [PathBuf::from("/h/a"), PathBuf::from("/h/y")]
        );
        // `/h/ab` shares a string prefix with `/h/a` but is not inside it.
        assert_eq!(
            plan.files.keys().collect::<Vec<_>>(),
            [&PathBuf::from("/h/ab")]
        );
    }

    #[test]
    fn lost_history_rescans_everything() {
        let plan = plan(&[
            event("/h/a.md", ITEM_CREATED | FILE, 1),
            event("/h", ROOT_CHANGED, 2),
        ]);
        assert!(plan.rescan_all);
        assert!(plan.files.is_empty());
        let replayed = super::plan(&[event("", HISTORY_DONE, 9)]);
        assert!(replayed.history_done && !replayed.rescan_all);
        assert_eq!(replayed.last_id, Some(9));
    }
}
