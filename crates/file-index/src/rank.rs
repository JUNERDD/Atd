//! Result ordering, ported from `apps/agent-service/src/file-search/rank.ts` (`rankCandidates`).
//!
//! Same tiers, boosts, penalties and tie-breaks, with two differences owned elsewhere: the index
//! has no "last used" date (Spotlight's `kMDItemLastUsedDate`), so recency is the modification
//! time and the `used` tie-break is absent; and files too large to attach are not sorted last
//! here, because the attachment size limit belongs to the caller's attachment rules. A caller
//! applies it with a stable sort on its own `tooLarge` flag.

use std::path::PathBuf;

use crate::fold::{self, NameRange, fold_name, fold_text};

/// A file the store returned, before ranking.
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
    /// Where the query matched the name; `None` for an empty query or a folder-only match.
    pub name_match: Option<NameRange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tier {
    Exact,
    Prefix,
    WordStart,
    Substring,
    Folder,
}

impl Tier {
    /// Tiers dominate: boosts and penalties only reorder files within about one tier.
    fn score(self) -> i64 {
        match self {
            Tier::Exact => 5000,
            Tier::Prefix => 4000,
            Tier::WordStart => 3000,
            Tier::Substring => 2000,
            Tier::Folder => 1000,
        }
    }
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// Modified within 1, 7 or 30 days.
const RECENCY_BOOSTS: [(u64, i64); 3] = [(DAY_MS, 300), (7 * DAY_MS, 200), (30 * DAY_MS, 100)];
const DEPTH_PENALTY: i64 = 20;
/// Output and cache folders that the scope keeps searchable but that rarely hold user files.
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
];
const NOISY_PENALTY: i64 = 500;

/// Orders candidates best first and drops those the query does not match. An empty query keeps
/// every candidate, newest first.
pub(crate) fn rank(query: &str, candidates: Vec<Candidate>, now_ms: u64) -> Vec<Ranked> {
    let query = fold_text(query.trim());
    let mut scored: Vec<(Ranked, u64)> = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let recency = candidate.modified_ms.unwrap_or(0);
        let mut score = 0;
        let mut name_match = None;
        if !query.is_empty() {
            let named = name_tier(&query, &candidate.name);
            let tier = match named {
                Some((tier, range)) => {
                    name_match = Some(range);
                    tier
                }
                None if fold::find(&fold_text(&candidate.location), &query).is_some() => {
                    Tier::Folder
                }
                None => continue,
            };
            score = tier.score() + recency_boost(now_ms.saturating_sub(recency))
                - placement_penalty(&candidate.location);
        }
        scored.push((
            Ranked {
                candidate,
                score,
                name_match,
            },
            recency,
        ));
    }
    scored.sort_by(|(a, a_recency), (b, b_recency)| {
        b.score
            .cmp(&a.score)
            .then(b_recency.cmp(a_recency))
            .then(utf16_len(&a.candidate.name).cmp(&utf16_len(&b.candidate.name)))
            .then(a.candidate.path.cmp(&b.candidate.path))
    });
    scored.into_iter().map(|(ranked, _)| ranked).collect()
}

/// The best tier of a name for a folded, non-empty query, with the occurrence that earned it.
fn name_tier(query: &[char], name: &str) -> Option<(Tier, NameRange)> {
    let folded_name = fold_name(name);
    let folded = &folded_name.folded;
    let at = |tier, from: usize| Some((tier, folded_name.range(from, from + query.len())));
    let dot = folded.iter().rposition(|char| *char == '.');
    if folded.as_slice() == query || dot.is_some_and(|dot| dot > 0 && &folded[..dot] == query) {
        return at(Tier::Exact, 0);
    }
    if folded.starts_with(query) {
        return at(Tier::Prefix, 0);
    }
    let word = folded_name
        .starts
        .iter()
        .find(|start| fold::starts_with_at(folded, query, **start));
    if let Some(start) = word {
        return at(Tier::WordStart, *start);
    }
    fold::find(folded, query).and_then(|index| at(Tier::Substring, index))
}

fn recency_boost(age_ms: u64) -> i64 {
    RECENCY_BOOSTS
        .iter()
        .find(|(window, _)| age_ms <= *window)
        .map_or(0, |(_, boost)| *boost)
}

/// Deeper files rank lower, and files under output or cache folders lower still.
fn placement_penalty(location: &str) -> i64 {
    if location.is_empty() {
        return 0;
    }
    let folders: Vec<&str> = location.split('/').collect();
    let noisy = folders
        .iter()
        .any(|folder| NOISY_FOLDERS.contains(&folder.to_lowercase().as_str()));
    folders.len() as i64 * DEPTH_PENALTY + if noisy { NOISY_PENALTY } else { 0 }
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

#[cfg(test)]
#[path = "rank_tests.rs"]
mod tests;
