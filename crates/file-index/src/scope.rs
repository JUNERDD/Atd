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
#[derive(Debug)]
pub(crate) struct Scope {
    pub roots: Vec<Root>,
    pub extensions: Extensions,
    /// Roots left out because they are not on a local, internal volume.
    pub skipped_roots: Vec<PathBuf>,
}

impl Scope {
    pub fn new(specs: Vec<RootSpec>, extensions: Extensions) -> Result<Self, Error> {
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

    /// Whether a directory below a root is pruned: by name or glob, or by a never-index marker
    /// inside it. `depth` counts folder levels below the root, 1 for a folder directly inside it.
    pub fn prunes_directory(&self, root: usize, path: &Path, name: &str, depth: usize) -> bool {
        self.rules_exclude_directory(root, path, name, depth)
            || path.join(NEVER_INDEX_MARKER).exists()
    }

    /// The fixed part of `prunes_directory`: names and globs, which never change while running.
    fn rules_exclude_directory(&self, root: usize, path: &Path, name: &str, depth: usize) -> bool {
        let root = &self.roots[root];
        exclusions::is_excluded_directory(name, root.skips_system_folder && depth == 1)
            || root.overrides.matched(path, true).is_ignore()
    }

    /// Whether a file found inside an unpruned directory is kept.
    pub fn keeps_file(&self, root: usize, path: &Path, name: &str) -> bool {
        !exclusions::is_excluded_file(name)
            && self.extensions.matches_name(name)
            && !self.roots[root].overrides.matched(path, false).is_ignore()
    }

    /// Whether a directory is inside a root and neither it nor a folder above it is pruned.
    pub fn admits_directory(&self, path: &Path) -> bool {
        self.chain_passes(path, |root, dir, name, depth| {
            !self.prunes_directory(root, dir, name, depth)
        })
    }

    /// Whether files below `path` could ever have been indexed: false when the name or glob
    /// rules exclude it or a folder above it. Lets event handling skip removals for folders the
    /// index never covers (dependency trees, build output), which would only add tombstones.
    pub fn may_hold_files(&self, path: &Path) -> bool {
        self.chain_passes(path, |root, dir, name, depth| {
            !self.rules_exclude_directory(root, dir, name, depth)
        })
    }

    fn chain_passes(
        &self,
        path: &Path,
        passes: impl Fn(usize, &Path, &str, usize) -> bool,
    ) -> bool {
        let Some((root, segments)) = self.root_of(path) else {
            return false;
        };
        let mut dir = self.roots[root].path.clone();
        segments.iter().enumerate().all(|(depth, folder)| {
            dir.push(folder);
            passes(root, &dir, folder, depth + 1)
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
