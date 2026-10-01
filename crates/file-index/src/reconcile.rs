//! Brings the store in line with the file system for the parts a plan names. Every decision
//! re-reads the file system, so a stale or coalesced event can never add a missing file.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::Error;
use crate::plan::Plan;
use crate::scope::Scope;
use crate::store::{NameStore, StoredFile};
use crate::walk::{self, Focus};

/// Applies `plan`, then makes the writes durable. Returns the number of files written.
pub(crate) fn apply(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    plan: &Plan,
    stop: &AtomicBool,
) -> Result<u64, Error> {
    let mut written = 0;
    if plan.rescan_all {
        for root in 0..scope.roots.len() {
            written += rebuild(scope, store, root, &scope.roots[root].path, stop)?;
        }
    } else {
        for subtree in &plan.subtrees {
            // A root inside the changed folder (iCloud Drive inside home's Library) is rebuilt
            // whole; the folder itself is rebuilt under its own root.
            for root in 0..scope.roots.len() {
                let path = &scope.roots[root].path;
                if path != subtree && path.starts_with(subtree) {
                    written += rebuild(scope, store, root, path, stop)?;
                }
            }
            if let Some((root, _)) = scope.root_of(subtree) {
                written += rebuild(scope, store, root, subtree, stop)?;
            }
        }
        for (folder, files) in &plan.files {
            written += refresh_files(scope, store, folder, files, stop)?;
        }
    }
    store.persist()?;
    Ok(written)
}

/// Drops every entry at or below `folder`, then walks it again.
pub(crate) fn rebuild(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    root: usize,
    folder: &Path,
    stop: &AtomicBool,
) -> Result<u64, Error> {
    let Some(rel) = scope.relative(root, folder) else {
        return Ok(0);
    };
    if !scope.may_hold_files(folder) {
        return Ok(0);
    }
    let key = scope.roots[root].key();
    store.remove_tree(&key, &rel)?;
    if !folder.is_dir() || !scope.admits_directory(folder) {
        return Ok(0);
    }
    let focus = if folder == scope.roots[root].path {
        Focus::All
    } else {
        Focus::Subtree(folder)
    };
    write_walk(scope, store, root, focus, stop)
}

/// Walks `focus` and upserts everything it finds.
pub(crate) fn write_walk(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    root: usize,
    focus: Focus<'_>,
    stop: &AtomicBool,
) -> Result<u64, Error> {
    let failure: Mutex<Option<Error>> = Mutex::new(None);
    let written = std::sync::atomic::AtomicU64::new(0);
    walk::walk(scope, root, focus, stop, &|batch| {
        let count = batch.len() as u64;
        match store.upsert(batch) {
            Ok(()) => {
                written.fetch_add(count, std::sync::atomic::Ordering::Relaxed);
            }
            Err(error) => {
                let mut slot = failure.lock().unwrap_or_else(|poison| poison.into_inner());
                slot.get_or_insert(error.into());
            }
        }
    });
    match failure
        .into_inner()
        .unwrap_or_else(|poison| poison.into_inner())
    {
        Some(error) => Err(error),
        None => Ok(written.into_inner()),
    }
}

/// Re-checks changed files in one folder: those the walker still finds are written with fresh
/// modification times, the others removed.
fn refresh_files(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    folder: &Path,
    files: &BTreeSet<std::path::PathBuf>,
    stop: &AtomicBool,
) -> Result<u64, Error> {
    let Some((root, _)) = scope.root_of(folder) else {
        return Ok(0);
    };
    let key = scope.roots[root].key();
    // Only names the index could hold: a removal of anything else would just add a tombstone.
    let changed: BTreeSet<String> = files
        .iter()
        .filter(|file| scope.extensions.matches_path(file))
        .filter_map(|file| scope.relative(root, file))
        .collect();
    if changed.is_empty() || !scope.may_hold_files(folder) {
        return Ok(0);
    }
    let mut found: Vec<StoredFile> = Vec::new();
    if folder.is_dir() && scope.admits_directory(folder) {
        let collected = Mutex::new(Vec::new());
        walk::walk(scope, root, Focus::Children(folder), stop, &|batch| {
            let mut kept = collected
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            kept.extend(batch.into_iter().filter(|file| changed.contains(&file.rel)));
        });
        found = collected
            .into_inner()
            .unwrap_or_else(|poison| poison.into_inner());
    }
    let present: BTreeSet<&str> = found.iter().map(|file| file.rel.as_str()).collect();
    for rel in changed.iter().filter(|rel| !present.contains(rel.as_str())) {
        store.remove(&key, rel)?;
    }
    let written = found.len() as u64;
    if !found.is_empty() {
        store.upsert(found)?;
    }
    Ok(written)
}
