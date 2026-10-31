//! A query as the search uses it. The part after the last `/` matches names; the parts before it
//! match the folders at the end of a file's location, so `src/main` finds `proj/src/main.rs`. A
//! pasted absolute or `~/` path keeps only what lies below its root. Every part is folded like
//! names (`fold::fold_query`).

use crate::fold::{self, fold_query};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pattern {
    /// The name part, folded; empty when the query names only folders (`src/`) or nothing.
    pub name: Vec<char>,
    /// The name part without its spaces, for fuzzy matching: `budget_2024` scores `budget2024`.
    pub fuzzy: String,
    /// `fold::mask` of `name`.
    pub mask: u64,
    /// `name` as bytes when it is ASCII without spaces: an ASCII name then matches it
    /// contiguously only if its own bytes hold it, ignoring case, which needs no preparing.
    pub ascii: Option<Box<[u8]>>,
    /// The folders before the name part, outermost first.
    pub folders: Vec<Vec<char>>,
    /// `fold::mask` of every folder part.
    pub folders_mask: u64,
    /// Search only recently modified files outside hidden, output and cache folders: the query
    /// is empty or one ASCII character, which would match nearly every name. Any other single
    /// character, an ideograph, a kana or a Hangul syllable, is a full query.
    pub recent: bool,
}

impl Pattern {
    /// `roots` holds each indexed root's real path and label.
    pub fn parse(text: &str, roots: &[(&str, &str)]) -> Self {
        let text = text.trim();
        let mut chars = text.chars();
        let recent = chars
            .next()
            .is_none_or(|first| first.is_ascii() && chars.next().is_none());
        let (below, label) = below_root(text, roots);
        let mut parts: Vec<&str> = below.split('/').collect();
        // `src/` ends with an empty part: a query for the files in matching folders.
        let name = fold_query(parts.pop().unwrap_or_default());
        let folders: Vec<Vec<char>> = std::iter::once(label)
            .chain(parts)
            .map(fold_query)
            .filter(|folder| !folder.is_empty())
            .collect();
        Self {
            fuzzy: name.iter().filter(|char| **char != ' ').collect(),
            mask: fold::mask(name.iter().copied()),
            ascii: (!name.is_empty() && name.iter().all(|char| char.is_ascii() && *char != ' '))
                .then(|| name.iter().map(|char| *char as u8).collect()),
            folders_mask: folders
                .iter()
                .fold(0, |mask, folder| mask | fold::mask(folder.iter().copied())),
            name,
            folders,
            recent,
        }
    }

    /// Nothing to match: list files newest first.
    pub fn is_empty(&self) -> bool {
        self.name.is_empty() && self.folders.is_empty()
    }
}

/// The part of `text` below the root it names, with that root's label; `text` itself when it
/// names none.
fn below_root<'a>(text: &'a str, roots: &[(&str, &'a str)]) -> (&'a str, &'a str) {
    if let Some(below) = text.strip_prefix("~/") {
        return (below, "");
    }
    roots
        .iter()
        .filter(|(path, _)| {
            let bytes = text.as_bytes();
            bytes.len() >= path.len()
                && bytes[..path.len()].eq_ignore_ascii_case(path.as_bytes())
                && bytes.get(path.len()).is_none_or(|next| *next == b'/')
        })
        .max_by_key(|(path, _)| path.len())
        .map_or((text, ""), |(path, label)| (&text[path.len()..], *label))
}
