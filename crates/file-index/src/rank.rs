//! Result ordering, the only ranker file search has: the service shows hits in this order.
//!
//! A name match falls in a tier: the whole name or its stem, a prefix, a word start or anywhere,
//! all contiguous after folding (so `budget_2024` is a prefix of `budget-2024.xlsx`). Below them
//! come files in a folder the query names, one that is the query, starts with it or has a word
//! starting with it (`tax` lists `Tax/w2-form.pdf`); then a fuzzy subsequence of the name that
//! `frizbee` scores with word-boundary, camelCase and separator bonuses (`mnrs` finds `main.rs`,
//! see `fuzzy.rs`); last, files whose folder holds the query only inside a word. Boosts for
//! recently modified files and penalties for depth and output or cache folders reorder files
//! within about one tier. Ties go to the newer file, then the shorter name, then the stored
//! path. The index keeps no "last used" date, and the attachment size limit belongs to the
//! caller's attachment rules, so neither orders results here.

use std::path::PathBuf;

use crate::fold::{self, FoldedName, NameRange, Words};

/// A ranked file, as the search hands it on.
#[derive(Debug, Clone)]
pub(crate) struct Candidate {
    pub path: PathBuf,
    pub name: String,
    /// Displayed parent folder, `/`-joined ('' = home).
    pub location: String,
    /// Epoch milliseconds.
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct Ranked {
    pub candidate: Candidate,
    pub score: i64,
    /// Where the query matched the name, sorted; empty for an empty query or a folder match.
    pub matches: Vec<NameRange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tier {
    Exact,
    Prefix,
    WordStart,
    Substring,
    /// A folder of the location is the query, starts with it or has a word starting with it;
    /// plus up to 60 for how it matched (`FOLDER_NAME_SCORES`).
    Folder,
    /// Plus a quality of up to `FUZZY_QUALITY` from the fuzzy score.
    Fuzzy,
    /// A folder of the location holds the query only inside a word.
    FolderSubstring,
}

impl Tier {
    /// Tiers dominate: boosts and penalties only reorder files within about one tier.
    pub const fn score(self) -> i64 {
        match self {
            Tier::Exact => 5000,
            Tier::Prefix => 4000,
            Tier::WordStart => 3000,
            Tier::Substring => 2000,
            Tier::Folder => 1500,
            Tier::Fuzzy => 500,
            Tier::FolderSubstring => 100,
        }
    }
}

/// The most a fuzzy match adds to its tier: with the largest recency boost it stays below the
/// folder tier, as every tier stays below the next without penalties.
pub(crate) const FUZZY_QUALITY: i64 = 600;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// Modified within 1, 7 or 30 days.
const RECENCY_BOOSTS: [(u64, i64); 3] = [(DAY_MS, 300), (7 * DAY_MS, 200), (30 * DAY_MS, 100)];
const DEPTH_PENALTY: i64 = 20;
/// Output and cache folders that rarely hold user files, folded. Outside git work trees the
/// scope skips the output folders among them; inside, ignore rules decide and these demote,
/// and the recent listing leaves them out.
pub(crate) const NOISY_FOLDERS: &[&str] = &[
    "tmp",
    "temp",
    "cache",
    "caches",
    "log",
    "logs",
    "vendor",
    "obj",
    "bin",
    "pods",
    "artifacts",
    "build",
    "dist",
    "out",
    "target",
    "coverage",
];
const NOISY_PENALTY: i64 = 500;
/// What a query folder earns for matching a location folder: whole, as a prefix, anywhere, or as
/// a subsequence; and what each location folder costs that the match passes over.
const FOLDER_SCORES: [i64; 4] = [60, 40, 20, 0];
const SKIPPED_FOLDER: i64 = 30;
/// What a plain query adds to the folder tier for a location folder by how its name matches:
/// whole (or before its last dot, as a name's stem), as a prefix, or at a word start.
const FOLDER_NAME_SCORES: [(Tier, i64); 3] =
    [(Tier::Exact, 60), (Tier::Prefix, 40), (Tier::WordStart, 20)];

/// The best contiguous tier of a prepared name for a folded, non-empty query, with the
/// occurrence that earned it. `None` leaves fuzzy matching to the search.
pub(crate) fn name_tier(query: &[char], words: &Words) -> Option<(Tier, NameRange)> {
    let chars = &words.chars;
    let at = |tier, from: usize| Some((tier, words.range(from, from + query.len())));
    if chars.as_slice() == query || chars.get(..words.stem) == Some(query) {
        return at(Tier::Exact, 0);
    }
    if chars.starts_with(query) {
        return at(Tier::Prefix, 0);
    }
    let word = words
        .starts
        .iter()
        .find(|start| fold::starts_with_at(chars, query, **start));
    if let Some(start) = word {
        return at(Tier::WordStart, *start);
    }
    fold::find(chars, query).and_then(|index| at(Tier::Substring, index))
}

/// The most a file whose name holds no contiguous match can score before its boosts and
/// penalties: a folder of its location is the query.
pub(crate) const MISSED_NAME_CEILING: i64 = Tier::Folder.score() + FOLDER_NAME_SCORES[0].1;

/// How a plain query matches the folders of a location, for files whose names miss it: the
/// folder tier with the best of its folders' name scores, else the folder-substring tier when
/// one holds the query inside a word, else `None`. Folders compare folded, as names do.
pub(crate) fn folder_match(
    query: &[char],
    location: &str,
    words: &mut Words,
) -> Option<(Tier, i64)> {
    location
        .split('/')
        .filter_map(|folder| {
            let folded = (!folder.is_ascii()).then(|| FoldedName::new(folder));
            words.fill(folder, folded.as_ref());
            let (tier, _) = name_tier(query, words)?;
            let named = FOLDER_NAME_SCORES.iter().find(|(named, _)| *named == tier);
            Some(named.map_or(
                (Tier::FolderSubstring, Tier::FolderSubstring.score()),
                |(_, bonus)| (Tier::Folder, Tier::Folder.score() + bonus),
            ))
        })
        .max_by_key(|(_, score)| *score)
}

/// How well a path query's folders match the end of a folded location: right to left, each
/// query folder matches the nearest location folder before the previous match. `None` when one
/// matches none.
pub(crate) fn folder_bonus(folders: &[Vec<char>], location: &str) -> Option<i64> {
    let segments: Vec<Vec<char>> = match location {
        "" => Vec::new(),
        _ => location
            .split('/')
            .map(|segment| segment.chars().collect())
            .collect(),
    };
    let (mut end, mut bonus) = (segments.len(), 0);
    for query in folders.iter().rev() {
        let (index, score) = (0..end)
            .rev()
            .find_map(|index| segment_score(query, &segments[index]).map(|score| (index, score)))?;
        bonus += score - SKIPPED_FOLDER * (end - index - 1) as i64;
        end = index;
    }
    Some(bonus)
}

fn segment_score(query: &[char], segment: &[char]) -> Option<i64> {
    let tier = if segment == query {
        0
    } else if segment.starts_with(query) {
        1
    } else if fold::find(segment, query).is_some() {
        2
    } else {
        let mut rest = segment.iter();
        if !query
            .iter()
            .all(|char| rest.any(|candidate| candidate == char))
        {
            return None;
        }
        3
    };
    Some(FOLDER_SCORES[tier])
}

/// A fuzzy score as tier quality: the share of the score a contiguous prefix match would earn.
pub(crate) fn fuzzy_quality(score: u16, needle_chars: usize) -> i64 {
    let scoring = frizbee::Scoring::default();
    let ideal =
        i64::from(scoring.match_score) * needle_chars as i64 + i64::from(scoring.prefix_bonus);
    i64::from(score).min(ideal) * FUZZY_QUALITY / ideal.max(1)
}

pub(crate) fn recency_boost(age_ms: u64) -> i64 {
    RECENCY_BOOSTS
        .iter()
        .find(|(window, _)| age_ms <= *window)
        .map_or(0, |(_, boost)| *boost)
}

/// Deeper files rank lower, and files under output or cache folders lower still.
pub(crate) fn placement_penalty(depth: u16, noisy: bool) -> i64 {
    i64::from(depth) * DEPTH_PENALTY + if noisy { NOISY_PENALTY } else { 0 }
}

/// Ranks candidates the way a query ranks stored files: they are stored in a list of their own
/// under the root `/h` and searched, so tests exercise the production path.
#[cfg(test)]
pub(crate) fn rank(query: &str, candidates: Vec<Candidate>, now_ms: u64) -> Vec<Ranked> {
    let mut names = crate::names::NameList::default();
    for candidate in &candidates {
        let below = candidate
            .path
            .strip_prefix("/h")
            .expect("candidates live under /h");
        names.insert(crate::store::StoredFile {
            root: "/h".into(),
            rel: format!("/{}", below.to_str().expect("UTF-8 test paths")),
            modified_secs: candidate.modified_ms.unwrap_or(0) / 1000,
        });
    }
    let pattern = crate::pattern::Pattern::parse(query, &[]);
    let absolute = |root: &str, rel: &str| Some(PathBuf::from(format!("{root}{rel}")));
    crate::search::search(
        &names,
        &pattern,
        None,
        now_ms,
        candidates.len().max(1),
        &absolute,
    )
}

#[cfg(test)]
#[path = "rank_tests.rs"]
mod tests;
