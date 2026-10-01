//! Every stored path, held in memory for mid-word name matches (root decision R10). The word
//! index only finds names whose words start with the query, so `port` misses `report.md`, which
//! the Spotlight backend it replaces does find. `MinidexStore` mirrors each write here and scans
//! this list when word matches run short; nothing outside `store.rs` sees it.

use std::collections::HashMap;

use crate::fold::{self, fold_text};
use crate::store::StoredFile;

/// Stored paths by root key, each with its modification time in whole seconds.
#[derive(Debug, Default)]
pub(crate) struct NameList {
    roots: HashMap<String, HashMap<Box<str>, u64>>,
}

impl NameList {
    pub fn insert(&mut self, file: StoredFile) {
        self.roots
            .entry(file.root)
            .or_default()
            .insert(file.rel.into_boxed_str(), file.modified_secs);
    }

    pub fn remove(&mut self, root: &str, rel: &str) {
        if let Some(files) = self.roots.get_mut(root) {
            files.remove(rel);
        }
    }

    /// Removes `rel` and everything below it; `""` removes the whole root. Folders compare
    /// without case at `/` boundaries, as the word index's prefix deletes do.
    pub fn remove_tree(&mut self, root: &str, rel: &str) {
        if rel.is_empty() {
            self.roots.remove(root);
        } else if let Some(files) = self.roots.get_mut(root) {
            files.retain(|stored, _| !is_below(stored, rel));
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.roots.values().map(HashMap::len).sum()
    }

    /// Files whose name contains `query` anywhere, folded for case and accents like ranking
    /// folds it; newest first, at most `cap`. An empty query matches nothing.
    pub fn containing(&self, query: &str, cap: usize) -> Vec<StoredFile> {
        let needle = fold_text(query);
        if needle.is_empty() {
            return Vec::new();
        }
        let ascii: Option<Vec<u8>> = needle
            .iter()
            .map(|char| u8::try_from(*char).ok().filter(u8::is_ascii))
            .collect();
        let mut found: Vec<StoredFile> = Vec::new();
        for (root, files) in &self.roots {
            for (rel, modified_secs) in files {
                let name = rel.rsplit('/').next().unwrap_or(rel);
                let matched = match &ascii {
                    Some(bytes) if name.is_ascii() => contains_ascii(name.as_bytes(), bytes),
                    _ => fold::find(&fold_text(name), &needle).is_some(),
                };
                if matched {
                    found.push(StoredFile {
                        root: root.clone(),
                        rel: rel.to_string(),
                        modified_secs: *modified_secs,
                    });
                }
            }
        }
        found.sort_unstable_by(|a, b| {
            b.modified_secs
                .cmp(&a.modified_secs)
                .then_with(|| a.rel.cmp(&b.rel))
        });
        found.truncate(cap);
        found
    }
}

fn is_below(stored: &str, folder: &str) -> bool {
    let (stored, folder) = (stored.as_bytes(), folder.as_bytes());
    stored.len() >= folder.len()
        && stored[..folder.len()].eq_ignore_ascii_case(folder)
        && stored.get(folder.len()).is_none_or(|next| *next == b'/')
}

/// `needle` is already lower case.
fn contains_ascii(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len()
        && haystack
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
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

    fn rels(files: &[StoredFile]) -> Vec<&str> {
        files.iter().map(|file| file.rel.as_str()).collect()
    }

    fn list(files: &[(&str, &str, u64)]) -> NameList {
        let mut list = NameList::default();
        for (root, rel, secs) in files {
            list.insert(file(root, rel, *secs));
        }
        list
    }

    #[test]
    fn matches_mid_word_in_names_only_newest_first() {
        let list = list(&[
            ("/h", "/report.md", 1),
            ("/h", "/Docs/ImportPlan.md", 3),
            ("/h", "/port/notes.md", 5),
            ("/h", "/Airport.TXT", 2),
        ]);
        assert_eq!(
            rels(&list.containing("PORT", 10)),
            ["/Docs/ImportPlan.md", "/Airport.TXT", "/report.md"]
        );
        assert_eq!(rels(&list.containing("port", 2)).len(), 2);
        assert!(list.containing("", 10).is_empty());
        assert!(list.containing("   ", 10).is_empty());
    }

    #[test]
    fn folds_accents_on_both_sides() {
        let list = list(&[
            ("/h", "/Mon Résumé.md", 2),
            ("/h", "/Cafe\u{301}-menu.md", 1),
        ]);
        assert_eq!(rels(&list.containing("sume", 10)), ["/Mon Résumé.md"]);
        assert_eq!(rels(&list.containing("afé", 10)), ["/Cafe\u{301}-menu.md"]);
        assert_eq!(rels(&list.containing("ÉSUM", 10)), ["/Mon Résumé.md"]);
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
        list.remove("/h", "/Docs-old/d.md");
        list.remove("/i", "/missing.md");
        assert_eq!(list.len(), 4);
        list.insert(file("/h", "/Docs-old/d.md", 1));
        list.remove_tree("/h", "/Docs");
        let found = list.containing(".md", 10);
        let mut left = rels(&found);
        left.sort_unstable();
        assert_eq!(
            left,
            [
                "/Docs-old/d.md",
                "/iCloud Drive/Docs/e.md",
                "/iCloud Drive/Docs/f.md"
            ]
        );
        list.remove_tree("/i", "");
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn upserts_replace_the_stored_time() {
        let mut list = list(&[("/h", "/a-report.md", 1), ("/h", "/b-report.md", 2)]);
        list.insert(file("/h", "/a-report.md", 9));
        assert_eq!(
            rels(&list.containing("port", 10)),
            ["/a-report.md", "/b-report.md"]
        );
        assert_eq!(list.len(), 2);
    }
}
