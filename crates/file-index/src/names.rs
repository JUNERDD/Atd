//! Every stored file in memory, grouped by folder, with what matching needs prepared once when a
//! file is stored: the word index finds names only by word prefix, so queries scan this list
//! instead, and no other scorer trims their candidates first (root decision R10). `MinidexStore`
//! mirrors each write here; only `store.rs` changes it and only the search reads it.

use std::collections::HashMap;

use crate::fold::{self, FoldedName};
use crate::rank::NOISY_FOLDERS;
use crate::store::StoredFile;

#[derive(Debug, Default)]
pub(crate) struct NameList {
    roots: Vec<RootNames>,
}

#[derive(Debug)]
struct RootNames {
    key: Box<str>,
    /// By stored folder path: `""` for the root itself, else `/` and the folders below it.
    folders: HashMap<Box<str>, Folder>,
}

/// A folder that holds stored files, its location prepared for matching.
#[derive(Debug)]
pub(crate) struct Folder {
    files: HashMap<Box<str>, File>,
    /// The location folded like a query, folder by folder, joined with `/`.
    pub folded: Box<str>,
    /// `fold::mask` of `folded`.
    pub mask: u64,
    /// Folder levels below the root.
    pub depth: u16,
    /// A folder on the way is an output or cache folder.
    pub noisy: bool,
    /// A folder on the way is hidden: its name starts with a dot (`.github`, `.idea`).
    pub hidden: bool,
}

/// What matching needs of one stored file.
#[derive(Debug)]
pub(crate) struct File {
    /// Whole seconds since the Unix epoch.
    pub modified_secs: u64,
    /// `fold::mask` of the folded name in lower case.
    pub mask: u64,
    /// The folded name, for non-ASCII names only.
    pub folded: Option<Box<FoldedName>>,
}

impl File {
    fn new(name: &str, modified_secs: u64) -> Self {
        let folded = (!name.is_ascii()).then(|| Box::new(FoldedName::new(name)));
        let mask = match &folded {
            None => fold::mask(name.chars().map(|char| char.to_ascii_lowercase())),
            Some(folded) => fold::mask(folded.text.chars().flat_map(char::to_lowercase)),
        };
        Self {
            modified_secs,
            mask,
            folded,
        }
    }
}

impl Folder {
    fn new(key: &str) -> Self {
        let location = key.trim_start_matches('/');
        let segments: Vec<String> = match location {
            "" => Vec::new(),
            _ => location
                .split('/')
                .map(|segment| fold::fold_query(segment).into_iter().collect())
                .collect(),
        };
        let folded = segments.join("/");
        Self {
            files: HashMap::new(),
            mask: fold::mask(folded.chars().filter(|char| *char != '/')),
            depth: segments.len().min(usize::from(u16::MAX)) as u16,
            noisy: segments
                .iter()
                .any(|segment| NOISY_FOLDERS.contains(&segment.as_str())),
            hidden: location.split('/').any(|folder| folder.starts_with('.')),
            folded: folded.into_boxed_str(),
        }
    }

    pub fn files(&self) -> impl Iterator<Item = (&str, &File)> {
        self.files.iter().map(|(name, file)| (&**name, file))
    }
}

/// The location a folder key shows: the key without its leading `/`.
pub(crate) fn location(key: &str) -> &str {
    key.trim_start_matches('/')
}

impl NameList {
    /// Adds a file or replaces the stored one with the same path.
    pub fn insert(&mut self, file: StoredFile) {
        let (folder, name) = split(&file.rel);
        let index = match self.roots.iter().position(|root| *root.key == *file.root) {
            Some(index) => index,
            None => {
                self.roots.push(RootNames {
                    key: file.root.into_boxed_str(),
                    folders: HashMap::new(),
                });
                self.roots.len() - 1
            }
        };
        let folders = &mut self.roots[index].folders;
        // Looked up before inserting, so an existing folder costs no new key.
        if !folders.contains_key(folder) {
            folders.insert(folder.into(), Folder::new(folder));
        }
        if let Some(stored) = folders.get_mut(folder) {
            stored
                .files
                .insert(name.into(), File::new(name, file.modified_secs));
        }
    }

    pub fn contains(&self, root: &str, rel: &str) -> bool {
        let (folder, name) = split(rel);
        self.root(root)
            .and_then(|root| root.folders.get(folder))
            .is_some_and(|folder| folder.files.contains_key(name))
    }

    /// Removes one file; returns whether it was stored.
    pub fn remove(&mut self, root: &str, rel: &str) -> bool {
        let (folder, name) = split(rel);
        let Some(root) = self.roots.iter_mut().find(|names| *names.key == *root) else {
            return false;
        };
        let Some(files) = root.folders.get_mut(folder) else {
            return false;
        };
        let removed = files.files.remove(name).is_some();
        if files.files.is_empty() {
            root.folders.remove(folder);
        }
        removed
    }

    /// Whether `rel` or anything below it is stored; `""` asks for the whole root. Folders
    /// compare without case at `/` boundaries, as the word index's prefix deletes do.
    pub fn holds_tree(&self, root: &str, rel: &str) -> bool {
        self.root(root).is_some_and(|root| {
            root.folders
                .iter()
                .any(|(key, folder)| holds(key, folder, rel))
        })
    }

    /// Removes `rel` and everything below it; returns whether anything was stored there.
    pub fn remove_tree(&mut self, root: &str, rel: &str) -> bool {
        let Some(root) = self.roots.iter_mut().find(|names| *names.key == *root) else {
            return false;
        };
        let before = root.folders.len();
        let mut removed = false;
        let (parent, name) = split(rel);
        root.folders.retain(|key, folder| {
            if is_below(key, rel) {
                return false;
            }
            if !rel.is_empty() && key.eq_ignore_ascii_case(parent) {
                let count = folder.files.len();
                folder
                    .files
                    .retain(|stored, _| !stored.eq_ignore_ascii_case(name));
                removed |= folder.files.len() != count;
            }
            !folder.files.is_empty()
        });
        removed || root.folders.len() != before
    }

    /// Every folder with stored files: its root's key, its key and the folder.
    pub fn folders(&self) -> impl Iterator<Item = (&str, &str, &Folder)> {
        self.roots.iter().flat_map(|root| {
            root.folders
                .iter()
                .map(|(key, folder)| (&*root.key, &**key, folder))
        })
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.folders()
            .map(|(_, _, folder)| folder.files.len())
            .sum()
    }

    fn root(&self, key: &str) -> Option<&RootNames> {
        self.roots.iter().find(|root| *root.key == *key)
    }
}

/// A stored path's folder key and name: `/a/b.md` is in `/a`, `/b.md` in the root, `""`.
fn split(rel: &str) -> (&str, &str) {
    rel.rsplit_once('/').unwrap_or(("", rel))
}

fn holds(key: &str, folder: &Folder, rel: &str) -> bool {
    if is_below(key, rel) {
        return true;
    }
    let (parent, name) = split(rel);
    !rel.is_empty()
        && key.eq_ignore_ascii_case(parent)
        && folder
            .files
            .keys()
            .any(|stored| stored.eq_ignore_ascii_case(name))
}

/// Whether a folder key is `folder` or below it; every key is below the root's `""`.
fn is_below(key: &str, folder: &str) -> bool {
    let (key, folder) = (key.as_bytes(), folder.as_bytes());
    key.len() >= folder.len()
        && key[..folder.len()].eq_ignore_ascii_case(folder)
        && key.get(folder.len()).is_none_or(|next| *next == b'/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(root: &str, rel: &str, modified_secs: u64) -> StoredFile {
        StoredFile {
            root: root.into(),
            rel: rel.into(),
            modified_secs,
        }
    }

    fn list(files: &[(&str, &str, u64)]) -> NameList {
        let mut list = NameList::default();
        for (root, rel, secs) in files {
            list.insert(file(root, rel, *secs));
        }
        list
    }

    fn rels(list: &NameList) -> Vec<String> {
        let mut rels: Vec<String> = list
            .folders()
            .flat_map(|(_, key, folder)| {
                folder.files().map(move |(name, _)| format!("{key}/{name}"))
            })
            .collect();
        rels.sort_unstable();
        rels
    }

    #[test]
    fn removes_files_and_trees_at_folder_boundaries() {
        let mut list = list(&[
            ("/h", "/Docs/a.md", 1),
            ("/h", "/docs/b/c.md", 1),
            ("/h", "/Docs-old/d.md", 1),
            ("/h", "/iCloud Drive/Docs/e.md", 1),
            ("/i", "/iCloud Drive/Docs/f.md", 1),
        ]);
        assert!(list.remove("/h", "/Docs-old/d.md"));
        assert!(!list.remove("/i", "/missing.md"));
        assert_eq!(list.len(), 4);
        list.insert(file("/h", "/Docs-old/d.md", 1));
        assert!(list.holds_tree("/h", "/DOCS"));
        assert!(list.remove_tree("/h", "/Docs"));
        assert!(!list.holds_tree("/h", "/Docs"));
        assert!(!list.remove_tree("/h", "/Docs"));
        assert_eq!(
            rels(&list),
            [
                "/Docs-old/d.md",
                "/iCloud Drive/Docs/e.md",
                "/iCloud Drive/Docs/f.md"
            ]
        );
        // A file path removes that file alone.
        assert!(list.remove_tree("/h", "/docs-old/D.md"));
        assert!(list.remove_tree("/i", ""));
        assert_eq!(rels(&list), ["/iCloud Drive/Docs/e.md"]);
    }

    #[test]
    fn upserts_replace_the_stored_time_and_prepare_matching() {
        let mut list = list(&[("/h", "/a-report.md", 1), ("/h", "/Logs/Café.md", 2)]);
        list.insert(file("/h", "/a-report.md", 9));
        assert_eq!(list.len(), 2);
        let (_, _, root) = list.folders().find(|(_, key, _)| key.is_empty()).unwrap();
        let (_, stored) = root.files().next().unwrap();
        assert_eq!(stored.modified_secs, 9);
        assert!(stored.folded.is_none());
        let (_, _, logs) = list.folders().find(|(_, key, _)| *key == "/Logs").unwrap();
        assert_eq!((&*logs.folded, logs.depth, logs.noisy), ("logs", 1, true));
        let (_, cafe) = logs.files().next().unwrap();
        assert_eq!(
            cafe.folded.as_ref().map(|folded| &*folded.text),
            Some("Cafe.md")
        );
        assert_eq!(
            cafe.mask & fold::mask("cafe".chars()),
            fold::mask("cafe".chars())
        );
    }
}
