//! The index's own bookkeeping, saved next to the store: what the store was built for and the
//! newest FSEvents id whose effects the store has made durable. A restart resumes the event
//! stream from that id instead of walking home again.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Bump when the stored path form or anything else about the store's contents changes.
const FORMAT: u32 = 1;

/// What a store's contents depend on; any difference means the store cannot be reused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Identity {
    /// The store implementation and its exact version.
    pub store: String,
    pub extensions: Vec<String>,
    /// Real root paths, in scope order.
    pub roots: Vec<String>,
    /// FSEvents database UUID of each root's volume, in `roots` order. A new UUID means the
    /// event history was reset and old event ids mean nothing.
    pub volumes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SavedState {
    pub format: u32,
    pub identity: Identity,
    /// A full walk finished after the store was created. False while the first walk runs.
    pub scan_complete: bool,
    /// Every event up to this id is reflected in the durable store.
    pub last_event_id: u64,
}

impl SavedState {
    pub fn new(identity: Identity) -> Self {
        Self {
            format: FORMAT,
            identity,
            scan_complete: false,
            last_event_id: 0,
        }
    }
}

/// How `start` brings the index up to date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StartPoint {
    /// Replay events after this id; the store is otherwise current.
    Resume { since: u64 },
    /// Discard the store and walk every root.
    Rebuild,
}

pub(crate) fn start_point(saved: Option<&SavedState>, current: &Identity) -> StartPoint {
    match saved {
        Some(saved)
            if saved.format == FORMAT
                && saved.scan_complete
                && saved.last_event_id != 0
                && &saved.identity == current =>
        {
            StartPoint::Resume {
                since: saved.last_event_id,
            }
        }
        _ => StartPoint::Rebuild,
    }
}

/// A missing, unreadable or malformed file reads as no state, which forces a rebuild.
pub(crate) fn load(path: &Path) -> Option<SavedState> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Replaces the file atomically, so a crash leaves either the old or the new state.
pub(crate) fn save(path: &Path, state: &SavedState) -> io::Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(state).map_err(io::Error::other)?)?;
    file.sync_all()?;
    fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Identity {
        Identity {
            store: "store=1".into(),
            extensions: vec!["md".into()],
            roots: vec!["/h".into()],
            volumes: vec!["uuid".into()],
        }
    }

    fn complete(last_event_id: u64) -> SavedState {
        SavedState {
            scan_complete: true,
            last_event_id,
            ..SavedState::new(identity())
        }
    }

    #[test]
    fn resumes_only_a_completed_matching_store() {
        let current = identity();
        assert_eq!(
            start_point(Some(&complete(42)), &current),
            StartPoint::Resume { since: 42 }
        );
        assert_eq!(start_point(None, &current), StartPoint::Rebuild);
        assert_eq!(
            start_point(Some(&SavedState::new(identity())), &current),
            StartPoint::Rebuild
        );
        assert_eq!(
            start_point(Some(&complete(0)), &current),
            StartPoint::Rebuild
        );
        let mut changed = current.clone();
        changed.extensions.push("txt".into());
        assert_eq!(
            start_point(Some(&complete(42)), &changed),
            StartPoint::Rebuild
        );
        changed = current.clone();
        changed.volumes = vec!["new-uuid".into()];
        assert_eq!(
            start_point(Some(&complete(42)), &changed),
            StartPoint::Rebuild
        );
    }

    #[test]
    fn round_trips_and_treats_garbage_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        assert_eq!(load(&path), None);
        save(&path, &complete(7)).unwrap();
        assert_eq!(load(&path), Some(complete(7)));
        fs::write(&path, b"{not json").unwrap();
        assert_eq!(load(&path), None);
    }
}
