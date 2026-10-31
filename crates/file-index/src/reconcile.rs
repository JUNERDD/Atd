//! Brings the store in line with the file system for the parts a plan names. Every decision
//! re-reads the file system, so a stale or coalesced event can never add a missing file. Writes
//! are not made durable here: the caller persists them with its saved state, at most every few
//! seconds (`background.rs`).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use crate::Error;
use crate::plan::Plan;
use crate::scope::Scope;
use crate::store::{NameStore, StoredFile};
use crate::walk::{self, Focus};

/// What applying a plan did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Applied {
    /// Files written (found again or newly).
    pub written: u64,
    /// The store changed: a file was written or removed.
    pub changed: bool,
}

impl Applied {
    fn add(&mut self, other: Applied) {
        self.written += other.written;
        self.changed |= other.changed;
    }
}

pub(crate) fn apply(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    plan: &Plan,
    stop: &AtomicBool,
) -> Result<Applied, Error> {
    let mut applied = Applied::default();
    if plan.rescan_all {
        for root in 0..scope.roots.len() {
            applied.add(rebuild(scope, store, root, &scope.roots[root].path, stop)?);
        }
        return Ok(applied);
    }
    for subtree in &plan.subtrees {
        // A root inside the changed folder (iCloud Drive inside home's Library) is rebuilt
        // whole; the folder itself is rebuilt under its own root.
        for root in 0..scope.roots.len() {
            let path = &scope.roots[root].path;
            if path != subtree && path.starts_with(subtree) {
                applied.add(rebuild(scope, store, root, path, stop)?);
            }
        }
        if let Some((root, _)) = scope.root_of(subtree) {
            applied.add(rebuild(scope, store, root, subtree, stop)?);
        }
    }
    for (folder, files) in &plan.files {
        applied.add(refresh_files(scope, store, folder, files, stop)?);
    }
    Ok(applied)
}

/// Drops every entry at or below `folder`, then walks it again.
pub(crate) fn rebuild(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    root: usize,
    folder: &Path,
    stop: &AtomicBool,
) -> Result<Applied, Error> {
    let Some(rel) = scope.relative(root, folder) else {
        return Ok(Applied::default());
    };
    if scope.never_indexed(folder, true) {
        return Ok(Applied::default());
    }
    let removed = store.remove_tree(&scope.roots[root].key(), &rel)?;
    let mut applied = Applied {
        written: 0,
        changed: removed,
    };
    if !folder.is_dir() || scope.directory_context(folder).is_none() {
        return Ok(applied);
    }
    let focus = if folder == scope.roots[root].path {
        Focus::All
    } else {
        Focus::Subtree(folder)
    };
    applied.add(write_walk(scope, store, root, focus, stop)?);
    Ok(applied)
}

/// Walks `focus` and upserts everything it finds.
pub(crate) fn write_walk(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    root: usize,
    focus: Focus<'_>,
    stop: &AtomicBool,
) -> Result<Applied, Error> {
    let failure: Mutex<Option<Error>> = Mutex::new(None);
    let written = AtomicU64::new(0);
    walk::walk(scope, root, focus, stop, &|batch| {
        let count = batch.len() as u64;
        match store.upsert(batch) {
            Ok(()) => {
                written.fetch_add(count, Ordering::Relaxed);
            }
            Err(error) => {
                let mut slot = failure.lock().unwrap_or_else(PoisonError::into_inner);
                slot.get_or_insert(error.into());
            }
        }
    });
    match failure.into_inner().unwrap_or_else(PoisonError::into_inner) {
        Some(error) => Err(error),
        None => {
            let written = written.into_inner();
            Ok(Applied {
                written,
                changed: written > 0,
            })
        }
    }
}

/// Re-checks changed files in one folder: those the walker still finds are written with fresh
/// modification times, the others removed if they were stored.
fn refresh_files(
    scope: &Arc<Scope>,
    store: &dyn NameStore,
    folder: &Path,
    files: &BTreeSet<PathBuf>,
    stop: &AtomicBool,
) -> Result<Applied, Error> {
    let Some((root, _)) = scope.root_of(folder) else {
        return Ok(Applied::default());
    };
    if scope.never_indexed(folder, true) {
        return Ok(Applied::default());
    }
    let key = scope.roots[root].key();
    // `None` when the folder is gone or pruned: then nothing in it is kept.
    let in_tree = if folder.is_dir() {
        scope.directory_context(folder)
    } else {
        None
    };
    // Only files the folder's rules could keep, or the store holds, need a look: most changes
    // are to files the index never covers, such as `~/.zsh_history` after every command.
    let keeps = |file: &Path| {
        let name = file.file_name().and_then(|name| name.to_str());
        in_tree
            .zip(name)
            .is_some_and(|(in_tree, name)| scope.keeps_file(root, file, name, in_tree))
    };
    let changed: BTreeSet<String> = files
        .iter()
        .filter_map(|file| {
            let rel = scope.relative(root, file)?;
            (keeps(file) || store.contains(&key, &rel)).then_some(rel)
        })
        .collect();
    if changed.is_empty() {
        return Ok(Applied::default());
    }
    let mut found: Vec<StoredFile> = Vec::new();
    if in_tree.is_some() {
        let collected = Mutex::new(Vec::new());
        walk::walk(scope, root, Focus::Children(folder), stop, &|batch| {
            let mut kept = collected.lock().unwrap_or_else(PoisonError::into_inner);
            kept.extend(batch.into_iter().filter(|file| changed.contains(&file.rel)));
        });
        found = collected
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner);
    }
    let present: BTreeSet<&str> = found.iter().map(|file| file.rel.as_str()).collect();
    let mut applied = Applied::default();
    for rel in changed.iter().filter(|rel| !present.contains(rel.as_str())) {
        applied.changed |= store.remove(&key, rel)?;
    }
    applied.written = found.len() as u64;
    if !found.is_empty() {
        applied.changed = true;
        store.upsert(found)?;
    }
    Ok(applied)
}
