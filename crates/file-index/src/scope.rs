use std::path::{Component, Path, PathBuf};

use ignore::overrides::{Override, OverrideBuilder};

use crate::Error;
use crate::exclusions::{self, NEVER_INDEX_MARKER, RAYCAST_GLOBS};
use crate::extensions::Extensions;
use crate::volume::{self, VolumeKind};

/// Shown in place of iCloud Drive's real path, which sits inside home's excluded Library folder.
pub const ICLOUD_LABEL: &str = "iCloud Drive";

/// A folder the index covers, as the caller describes it.
#[derive(Debug, Clone)]
pub struct RootSpec {
    pub path: PathBuf,
    /// Prefix of the locations reported for files below this root; empty for home.
    pub label: String,
    /// Skip the OS-owned `Library` folder directly inside this root (true for home).
    pub skips_system_folder: bool,
}

impl RootSpec {
    /// Home, plus iCloud Drive when it exists, as scope.ts `resolveSearchScope` defines them.
    pub fn home(home: &Path) -> Vec<RootSpec> {
        let mut roots = vec![RootSpec {
            path: home.to_path_buf(),
            label: String::new(),
            skips_system_folder: true,
        }];
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        if icloud.is_dir() {
            roots.push(RootSpec {
                path: icloud,
                label: ICLOUD_LABEL.into(),
                skips_system_folder: false,
            });
        }
        roots
    }
}

#[derive(Debug)]
pub(crate) struct Root {
    /// Real path; FSEvents and the walker report real paths.
    pub path: PathBuf,
    pub label: String,
    pub skips_system_folder: bool,
    pub overrides: Override,
}

impl Root {
    /// The store key: roots are kept apart so a root's entries can be dropped together.
    pub fn key(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

/// The roots and the rules deciding which paths below them are indexed.
///
/// Inside a git work tree, a folder below a root that holds `.git`, every file the repository's
/// ignore rules keep is indexed whatever its name, hidden folders included; only dependency and
/// tool folders (`exclusions::ALWAYS_EXCLUDED`), app bundles, the globs and never-index markers
/// keep things out. Elsewhere only non-hidden files with a listed extension are, outside hidden
/// and output folders. A work tree's root is admitted by the rules
/// of the folder holding it, so it is never hidden, and a root itself never starts one: a home
/// folder kept in git would otherwise turn all of home into one work tree.
#[derive(Debug)]
pub(crate) struct Scope {
    pub roots: Vec<Root>,
    pub extensions: Extensions,
    /// Roots left out because they are not on a local, internal volume.
    pub skipped_roots: Vec<PathBuf>,
    /// The index's own data folder: never indexed, so its writes never cause work.
    own_dir: Option<PathBuf>,
}

impl Scope {
    pub fn new(
        specs: Vec<RootSpec>,
        extensions: Extensions,
        own_dir: Option<PathBuf>,
    ) -> Result<Self, Error> {
        let mut roots = Vec::new();
        let mut skipped_roots = Vec::new();
        for spec in specs {
            let path = spec.path.canonicalize().map_err(|error| {
                Error::InvalidOptions(format!("root {} unreadable: {error}", spec.path.display()))
            })?;
            if volume::classify(&path) != VolumeKind::Local {
                skipped_roots.push(path);
                continue;
            }
            let mut builder = OverrideBuilder::new(&path);
            for glob in RAYCAST_GLOBS {
                builder
                    .add(glob)
                    .map_err(|error| Error::Internal(error.to_string()))?;
            }
            let overrides = builder
                .build()
                .map_err(|error| Error::Internal(error.to_string()))?;
            let (label, skips_system_folder) = (spec.label, spec.skips_system_folder);
            roots.push(Root {
                path,
                label,
                skips_system_folder,
                overrides,
            });
        }
        if roots.is_empty() {
            return Err(Error::InvalidOptions("no root is on a local volume".into()));
        }
        Ok(Self {
            roots,
            extensions,
            skipped_roots,
            own_dir,
        })
    }

    /// The most specific root containing `path`, with the components below it.
    pub fn root_of<'a>(&self, path: &'a Path) -> Option<(usize, Vec<&'a str>)> {
        let (index, root) = self
            .roots
            .iter()
            .enumerate()
            .filter(|(_, root)| path.starts_with(&root.path))
            .max_by_key(|(_, root)| root.path.as_os_str().len())?;
        let segments = path
            .strip_prefix(&root.path)
            .ok()?
            .components()
            .map(|component| match component {
                Component::Normal(name) => name.to_str(),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
        Some((index, segments))
    }

    /// Whether a directory below a root is pruned: by name or glob, by a never-index marker
    /// inside it, or as the index's own folder. `depth` counts folder levels below the root, 1
    /// for a folder directly inside it; `in_tree` says whether the folder holding it lies inside
    /// a work tree.
    pub fn prunes_directory(
        &self,
        root: usize,
        path: &Path,
        name: &str,
        depth: usize,
        in_tree: bool,
    ) -> bool {
        self.rules_exclude_directory(root, path, name, depth, in_tree)
            || path.join(NEVER_INDEX_MARKER).exists()
    }

    /// The part of `prunes_directory` that needs no disk access.
    fn rules_exclude_directory(
        &self,
        root: usize,
        path: &Path,
        name: &str,
        depth: usize,
        in_tree: bool,
    ) -> bool {
        let spec = &self.roots[root];
        let home_level = spec.skips_system_folder && depth == 1;
        exclusions::is_excluded_directory(name, in_tree, home_level)
            || spec.overrides.matched(path, true).is_ignore()
            || self.own_dir.as_deref() == Some(path)
    }

    /// Whether an admitted directory outside any work tree starts one.
    pub fn starts_tree(path: &Path, depth: usize) -> bool {
        depth >= 1 && path.join(".git").exists()
    }

    /// Whether a file found inside an unpruned directory is kept.
    pub fn keeps_file(&self, root: usize, path: &Path, name: &str, in_tree: bool) -> bool {
        !exclusions::is_excluded_file(name, in_tree)
            && (in_tree || self.extensions.matches_name(name))
            && !self.roots[root].overrides.matched(path, false).is_ignore()
    }

    /// Where a directory stands: `None` when it lies outside every root or it or a folder above
    /// it is pruned, otherwise whether it lies inside a work tree. Reads the disk along the way
    /// for markers and work trees.
    pub fn directory_context(&self, path: &Path) -> Option<bool> {
        let (root, segments) = self.root_of(path)?;
        let mut dir = self.roots[root].path.clone();
        let mut in_tree = false;
        for (index, folder) in segments.iter().enumerate() {
            dir.push(folder);
            if self.prunes_directory(root, &dir, folder, index + 1, in_tree) {
                return None;
            }
            in_tree = in_tree || Self::starts_tree(&dir, index + 1);
        }
        Some(in_tree)
    }

    /// Whether nothing at or below `path` can ever be indexed, by the rules that need no disk
    /// access: below a hidden folder directly inside a root, home's `Library`, `.git` or a
    /// dependency folder, an app bundle, a glob or the index's own folder. `is_dir` says whether
    /// `path` itself is a folder; a file is judged by the folders holding it. A path holding a
    /// root never is. Lets event handling drop events before planning them.
    pub fn never_indexed(&self, path: &Path, is_dir: bool) -> bool {
        if self.roots.iter().any(|root| root.path.starts_with(path)) {
            return false;
        }
        if self
            .own_dir
            .as_deref()
            .is_some_and(|own| path.starts_with(own))
        {
            return true;
        }
        let Some((root, mut segments)) = self.root_of(path) else {
            return true;
        };
        if !is_dir {
            segments.pop();
        }
        let mut dir = self.roots[root].path.clone();
        segments.iter().enumerate().any(|(index, folder)| {
            dir.push(folder);
            // Below the first level a folder may lie inside a work tree, whose rules keep more.
            self.rules_exclude_directory(root, &dir, folder, index + 1, index > 0)
        })
    }

    /// The index of the root a store key names.
    pub fn root_by_key(&self, key: &str) -> Option<usize> {
        self.roots
            .iter()
            .position(|root| root.path.as_os_str() == key)
    }

    /// Absolute path of a stored entry.
    pub fn absolute(&self, root: usize, rel: &str) -> PathBuf {
        let root = &self.roots[root];
        let below = rel.trim_start_matches('/');
        let below = if root.label.is_empty() {
            below
        } else {
            below
                .strip_prefix(root.label.as_str())
                .unwrap_or(below)
                .trim_start_matches('/')
        };
        root.path.join(below)
    }

    /// The stored form of a path inside a root: `/`, the root's label, then the folders below it,
    /// `/`-joined. It equals the location a file shows, so it is unique across roots and its words
    /// are the folder words a query can match. The root itself maps to `""` or `"/<label>"`.
    pub fn relative(&self, root: usize, path: &Path) -> Option<String> {
        let root = &self.roots[root];
        let below = path.strip_prefix(&root.path).ok()?;
        let mut rel = String::new();
        if !root.label.is_empty() {
            rel.push('/');
            rel.push_str(&root.label);
        }
        for component in below.components() {
            rel.push('/');
            rel.push_str(component.as_os_str().to_str()?);
        }
        Some(rel)
    }
}
