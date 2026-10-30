//! Directory walking with the `ignore` crate: `.gitignore`, `.git/info/exclude`, the global git
//! excludes file and `.ignore` files apply inside git repositories, as in git and ripgrep. The
//! scope's exclusions prune on top, with the work trees each walk enters deciding which of them
//! apply (`Scope`); hidden entries reach the scope, which keeps them inside work trees. Links are
//! never followed and the walk stays on the root's file system, so mounted volumes below a root
//! are not entered.
//!
//! Every walk starts at a root, even when only one folder changed: `ignore` applies a parent
//! folder's rules to paths directly, not to their ancestors, so a walk started deep inside an
//! ignored folder would not see that it is ignored. A focused walk instead descends only along
//! the changed folder's ancestors, which reads one listing per level and applies every rule
//! exactly as the full scan does.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
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

/// The work trees one walk has entered. A directory is checked for `.git` when it is admitted,
/// before the walk reads it, so its entries always see whether they lie inside a work tree.
#[derive(Debug)]
struct Trees {
    root: PathBuf,
    found: RwLock<HashSet<PathBuf>>,
}

impl Trees {
    /// Whether `dir` is a work tree's root or lies below one.
    fn holds(&self, dir: &Path) -> bool {
        let found = self.found.read().unwrap_or_else(PoisonError::into_inner);
        !found.is_empty()
            && dir
                .ancestors()
                .take_while(|folder| *folder != self.root)
                .any(|folder| found.contains(folder))
    }

    fn holds_parent_of(&self, path: &Path) -> bool {
        path.parent().is_some_and(|parent| self.holds(parent))
    }

    fn add(&self, dir: &Path) {
        let mut found = self.found.write().unwrap_or_else(PoisonError::into_inner);
        found.insert(dir.to_path_buf());
    }
}

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
        .hidden(false)
        .follow_links(false)
        .same_file_system(true)
        .current_dir(&root_path)
        .overrides(scope.roots[root].overrides.clone());
    let trees = Arc::new(Trees {
        root: root_path.clone(),
        found: RwLock::default(),
    });
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
    let filter_trees = Arc::clone(&trees);
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
        !is_dir || admits(&filter_scope, &filter_trees, root, entry)
    });
    let mut visitors = Visitors {
        scope,
        trees: &trees,
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

/// Whether the walk enters a directory, noting a work tree it starts.
fn admits(scope: &Scope, trees: &Trees, root: usize, entry: &DirEntry) -> bool {
    // Names that are not UTF-8 cannot be matched or shown, so their folders are skipped.
    let Some(name) = entry.file_name().to_str() else {
        return false;
    };
    let (path, depth) = (entry.path(), entry.depth());
    let in_tree = trees.holds_parent_of(path);
    if scope.prunes_directory(root, path, name, depth, in_tree) {
        return false;
    }
    if !in_tree && Scope::starts_tree(path, depth) {
        trees.add(path);
    }
    true
}

struct Visitors<'s> {
    scope: &'s Arc<Scope>,
    trees: &'s Trees,
    root: usize,
    stop: &'s AtomicBool,
    sink: &'s (dyn Fn(Vec<StoredFile>) + Sync),
}

impl<'s> ParallelVisitorBuilder<'s> for Visitors<'s> {
    fn build(&mut self) -> Box<dyn ParallelVisitor + 's> {
        Box::new(Visitor {
            scope: self.scope,
            trees: self.trees,
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
    trees: &'s Trees,
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
        let in_tree = self.trees.holds_parent_of(path);
        if !self.scope.keeps_file(self.root, path, name, in_tree) {
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
