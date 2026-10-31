//! Fuzzy name matching with `frizbee`: which part of a name it reads, how its scores become tier
//! quality, and where a match lies. A name's extension takes part only as far as the query ends
//! by spelling its start, so letters inside an extension never complete a match: `tax` finds
//! `travel_expenses.pdf` but not `contacts.txt`, while `mnrs` still finds `main.rs` and a query
//! typed on into the extension (`budgetx`) keeps `budget.xlsx`.

use frizbee::{CaseMatching, Config, Matcher, SortStrategy};

use crate::fold::{self, FoldedName, NameRange};
use crate::rank;

/// A query's fuzzy needle, compiled once.
pub(crate) struct Fuzzy {
    matcher: Matcher,
    /// The needle: the folded query without its spaces, so `budget_2024` scores `budget2024`.
    needle: Box<[char]>,
}

impl Fuzzy {
    /// `None` when fuzzy matching adds nothing: a one-char needle matches contiguously or not
    /// at all.
    pub fn new(needle: &str) -> Option<Self> {
        let chars: Box<[char]> = needle.chars().collect();
        let config = Config::default()
            .max_typos(Some(0))
            .casing(CaseMatching::Ignore)
            .sort(SortStrategy::IndexAsc);
        (chars.len() > 1).then(|| Self {
            matcher: Matcher::new(needle, &config),
            needle: chars,
        })
    }

    /// What matching reads of a stored name: its stem, and of its extension the longest start
    /// that the needle ends with, short of the whole needle so the stem always takes part.
    pub fn text<'a>(&self, name: &'a str, folded: Option<&'a FoldedName>) -> &'a str {
        let text = fold::fuzzy_text(name, folded);
        let Some(dot) = extension_dot(text) else {
            return text;
        };
        let extension = &text[dot + 1..];
        let needle = &self.needle;
        let first = extension
            .chars()
            .next()
            .and_then(|char| char.to_lowercase().next());
        // Where the needle's tail may start, longest tail first: no longer than the extension.
        let from = needle.len().saturating_sub(extension.len()).max(1);
        (from..needle.len())
            .filter(|start| Some(needle[*start]) == first)
            .find_map(|start| spelled(extension, &needle[start..]))
            .map_or(&text[..dot], |bytes| &text[..dot + 1 + bytes])
    }

    /// The tier quality of every text that matches, with its index in `texts`.
    pub fn qualities(&mut self, texts: &[&str]) -> Vec<(usize, i64)> {
        let needle = self.needle.len();
        self.matcher
            .match_list(texts)
            .into_iter()
            .map(|found| {
                let quality = rank::fuzzy_quality(found.score, needle);
                (found.index as usize, quality)
            })
            .collect()
    }

    /// Where the needle matches a name that `qualities` matched.
    pub fn ranges(&mut self, name: &str, folded: Option<&FoldedName>) -> Vec<NameRange> {
        let text = self.text(name, folded);
        let Some(found) = self.matcher.match_one_indices(text, 0) else {
            return Vec::new();
        };
        let mut bytes = found.indices;
        bytes.sort_unstable();
        fold::byte_ranges(folded, &bytes)
    }
}

/// The byte offset of the dot that starts a name's extension: the last dot, with something
/// other than separators before it (`.env` has none) and after it only a word (so `v1.2 notes`
/// has none either).
fn extension_dot(text: &str) -> Option<usize> {
    // A byte search: a dot is ASCII, never part of another char, and this runs for every
    // fuzzy candidate.
    let dot = text.bytes().rposition(|byte| byte == b'.')?;
    let extension = &text[dot + 1..];
    let named = text[..dot].chars().any(|char| !fold::is_separator(char));
    (named && !extension.is_empty() && !extension.chars().any(fold::is_separator)).then_some(dot)
}

/// How many bytes at the start of `extension` spell `tail`, a lower-case needle part, ignoring
/// case; `None` when it does not start with it.
fn spelled(extension: &str, tail: &[char]) -> Option<usize> {
    let mut rest = tail;
    for (at, char) in extension.char_indices() {
        if rest.is_empty() {
            return Some(at);
        }
        for lower in char.to_lowercase() {
            let (first, more) = rest.split_first()?;
            if *first != lower {
                return None;
            }
            rest = more;
        }
    }
    rest.is_empty().then_some(extension.len())
}
