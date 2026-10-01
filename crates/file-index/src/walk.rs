//! Directory walking with the `ignore` crate: `.gitignore`, `.git/info/exclude`, the global git
//! excludes file and `.ignore` files apply inside git repositories, as in git and ripgrep. The
//! scope's exclusions prune on top. Links are never followed and the walk stays on the root's
//! file system, so mounted volumes below a root are not entered.
//!
//! Every walk starts at a root, even when only one folder changed: `ignore` applies a parent
//! folder's rules to paths directly, not to their ancestors, so a walk started deep inside an
//! ignored folder would not see that it is ignored. A focused walk instead descends only along
//! the changed folder's ancestors, which reads one listing per level and applies every rule
//! exactly as the full scan does.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

use ignore::{DirEntry, ParallelVisitor, ParallelVisitorBuilder, WalkBuilder, WalkState};

use crate::scope::Scope;
use crate::store::StoredFile;

/// Which part of a root a walk covers.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Focus<'a> {
    /// The whole root.
    All,
    /// A folder and everything below it.
    Subtree(&'a Path),
    /// The files directly inside a folder.
    Children(&'a Path),
}

/// Files per batch handed to the sink.
const BATCH: usize = 1024;
/// Threads for a full scan: enough to hide file-system latency without competing with the app.
const SCAN_THREADS: usize = 4;

/// Walks `focus` inside root `root`, handing kept files to `sink` in batches. Returns false when
/// `stop` ended the walk early. Unreadable folders are skipped.
pub(crate) fn walk(
    scope: &Arc<Scope>,
    root: usize,
    focus: Focus<'_>,
    stop: &AtomicBool,
    sink: &(dyn Fn(Vec<StoredFile>) + Sync),
) -> bool {
    let root_path = scope.roots[root].path.clone();
    let mut builder = WalkBuilder::new(&root_path);
    builder
        .follow_links(false)
        .same_file_system(true)
        .current_dir(&root_path)
        .overrides(scope.roots[root].overrides.clone());
    let (target, children_only) = match focus {
        Focus::All => (None, false),
        Focus::Subtree(path) => (Some(path.to_path_buf()), false),
        Focus::Children(path) => (Some(path.to_path_buf()), true),
    };
    if let (Some(target), true) = (&target, children_only) {
        let depth = target
            .strip_prefix(&root_path)
            .map_or(0, |below| below.components().count());
        builder.max_depth(Some(depth + 1));
    }
    let filter_scope = Arc::clone(scope);
    builder.filter_entry(move |entry| {
        let path = entry.path();
        let is_dir = entry.file_type().is_some_and(|kind| kind.is_dir());
        if let Some(target) = &target {
            let on_chain = target.starts_with(path);
            let inside = if children_only {
                !is_dir && path.parent() == Some(target.as_path())
            } else {
                path.starts_with(target)
            };
            if !on_chain && !inside {
                return false;
            }
        }
        !is_dir || !prunes(&filter_scope, root, entry)
    });
    let mut visitors = Visitors {
        scope,
        root,
        stop,
        sink,
    };
    if matches!(focus, Focus::All) {
        builder
            .threads(SCAN_THREADS)
            .build_parallel()
            .visit(&mut visitors);
    } else {
        let mut visitor = visitors.build();
        for entry in builder.build() {
            if visitor.visit(entry) == WalkState::Quit {
                break;
            }
        }
    }
    !stop.load(Ordering::Relaxed)
}

fn prunes(scope: &Scope, root: usize, entry: &DirEntry) -> bool {
    let name = entry.file_name().to_str();
    // Names that are not UTF-8 cannot be matched or shown, so their folders are skipped.
    name.is_none_or(|name| scope.prunes_directory(root, entry.path(), name, entry.depth()))
}

struct Visitors<'s> {
    scope: &'s Arc<Scope>,
    root: usize,
    stop: &'s AtomicBool,
    sink: &'s (dyn Fn(Vec<StoredFile>) + Sync),
}

impl<'s> ParallelVisitorBuilder<'s> for Visitors<'s> {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's> {
        Box::new(Visitor {
            scope: self.scope,
            root: self.root,
            stop: self.stop,
            sink: self.sink,
            batch: Vec::with_capacity(BATCH),
        })
    }
}

/// One walk thread's state; its last partial batch goes to the sink when it is dropped.
struct Visitor<'s> {
    scope: &'s Scope,
    root: usize,
    stop: &'s AtomicBool,
    sink: &'s (dyn Fn(Vec<StoredFile>) + Sync),
    batch: Vec<StoredFile>,
}

impl ParallelVisitor for Visitor<'_> {
    fn visit(&mut self, entry: Result<DirEntry, ignore::Error>) -> WalkState {
        if self.stop.load(Ordering::Relaxed) {
            return WalkState::Quit;
        }
        let Ok(entry) = entry else {
            return WalkState::Continue;
        };
        if entry.file_type().is_some_and(|kind| kind.is_file())
            && let Some(file) = self.keep(&entry)
        {
            self.batch.push(file);
            if self.batch.len() >= BATCH {
                (self.sink)(std::mem::replace(
                    &mut self.batch,
                    Vec::with_capacity(BATCH),
                ));
            }
        }
        WalkState::Continue
    }
}

impl Visitor<'_> {
    fn keep(&self, entry: &DirEntry) -> Option<StoredFile> {
        let path = entry.path();
        let name = entry.file_name().to_str()?;
        if !self.scope.keeps_file(self.root, path, name) {
            return None;
        }
        let modified = entry.metadata().ok()?.modified().ok()?;
        let modified_secs = modified
            .duration_since(UNIX_EPOCH)
            .map_or(0, |age| age.as_secs());
        let rel = self.scope.relative(self.root, path)?;
        Some(StoredFile {
            root: self.scope.roots[self.root].key(),
            rel,
            modified_secs,
        })
    }
}

impl Drop for Visitor<'_> {
    fn drop(&mut self) {
        if !self.batch.is_empty() {
            (self.sink)(std::mem::take(&mut self.batch));
        }
    }
}
