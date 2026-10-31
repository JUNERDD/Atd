//! One pass over every stored file (`names.rs`), with no other scorer trimming candidates first.
//! A mask skips names that lack a query char without reading them; the rest are prepared in
//! reused buffers and tried against the contiguous tiers. A name that misses still ranks when a
//! folder of its location matches, and otherwise is scored fuzzily (`fuzzy.rs`) in batches.
//! Only the best `keep` entries survive, and a batch skips files that could not reach them, so
//! memory and work stay bounded however broad the query.

use std::cmp::Ordering;
use std::path::PathBuf;

use crate::fold::{self, NameRange, Words};
use crate::fuzzy::Fuzzy;
use crate::names::{self, File, Folder, NameList};
use crate::pattern::Pattern;
use crate::rank::{self, Candidate, FUZZY_QUALITY, MISSED_NAME_CEILING, Ranked, Tier};

/// Fuzzy candidates scored per batch.
const BATCH: usize = 4096;

#[derive(Debug, Clone, Copy)]
enum Matched {
    Nothing,
    Range(NameRange),
    Fuzzy,
}

#[derive(Debug, Clone, Copy)]
struct Entry<'a> {
    score: i64,
    secs: u64,
    /// UTF-16 length of the NFC name.
    len: u32,
    root: &'a str,
    folder: &'a str,
    name: &'a str,
    file: &'a File,
    matched: Matched,
}

/// Best first: score, then the newer file, the shorter name and the stored path.
fn order(a: &Entry<'_>, b: &Entry<'_>) -> Ordering {
    b.score
        .cmp(&a.score)
        .then(b.secs.cmp(&a.secs))
        .then(a.len.cmp(&b.len))
        .then_with(|| (a.root, a.folder, a.name).cmp(&(b.root, b.folder, b.name)))
}

/// The best `keep` entries so far. Once it holds that many, `floor` is the score an entry needs
/// to stay in the running.
struct Best<'a> {
    entries: Vec<Entry<'a>>,
    keep: usize,
    floor: Option<i64>,
}

impl<'a> Best<'a> {
    fn push(&mut self, entry: Entry<'a>) {
        if self.floor.is_some_and(|floor| entry.score < floor) {
            return;
        }
        self.entries.push(entry);
        if self.entries.len() >= (self.keep * 2).max(64) {
            self.trim();
        }
    }

    fn trim(&mut self) {
        if self.entries.len() > self.keep {
            self.entries.select_nth_unstable_by(self.keep - 1, order);
            self.entries.truncate(self.keep);
        }
        if self.entries.len() == self.keep {
            self.floor = self.entries.iter().map(|entry| entry.score).min();
        }
    }
}

/// Files whose name holds every query char but no contiguous match, waiting for a batch.
struct Pending<'a> {
    fuzzy: Fuzzy,
    entries: Vec<(Entry<'a>, Option<i64>)>,
}

impl<'a> Pending<'a> {
    /// Queues a file whose entry carries its score without the tier; `fallback` is its score
    /// as a folder match, used when the name does not match after all.
    fn add(&mut self, best: &mut Best<'a>, entry: Entry<'a>, fallback: Option<i64>) {
        let bound = entry.score + Tier::Fuzzy.score() + FUZZY_QUALITY;
        if best.floor.is_some_and(|floor| bound < floor) {
            return;
        }
        self.entries.push((entry, fallback));
        if self.entries.len() == BATCH {
            self.score(best);
        }
    }

    fn score(&mut self, best: &mut Best<'a>) {
        let texts: Vec<&str> = self
            .entries
            .iter()
            .map(|(entry, _)| self.fuzzy.text(entry.name, entry.file.folded.as_deref()))
            .collect();
        let mut matched = vec![false; texts.len()];
        for (index, quality) in self.fuzzy.qualities(&texts) {
            let (entry, _) = self.entries[index];
            matched[index] = true;
            best.push(Entry {
                score: entry.score + Tier::Fuzzy.score() + quality,
                matched: Matched::Fuzzy,
                ..entry
            });
        }
        for ((entry, fallback), matched) in self.entries.drain(..).zip(matched) {
            if let (false, Some(score)) = (matched, fallback) {
                best.push(Entry { score, ..entry });
            }
        }
    }
}

/// Ranks every stored file against `pattern`, keeping at most `keep`, best first. `since_secs`
/// limits the search to files modified since then; `absolute` turns a root key and a stored path
/// into the file's path. The recent listing (`Pattern::recent`) leaves out hidden folders and
/// output or cache folders, whose files tools and builds write rather than the user; any other
/// query still finds them.
pub(crate) fn search(
    names: &NameList,
    pattern: &Pattern,
    since_secs: Option<u64>,
    now_ms: u64,
    keep: usize,
    absolute: &dyn Fn(&str, &str) -> Option<PathBuf>,
) -> Vec<Ranked> {
    let mut best = Best {
        entries: Vec::new(),
        keep: keep.max(1),
        floor: None,
    };
    let mut pending = Fuzzy::new(&pattern.fuzzy).map(|fuzzy| Pending {
        fuzzy,
        entries: Vec::new(),
    });
    let mut words = Words::default();
    let folder_text: String = pattern.name.iter().collect();
    for (root, key, folder) in names.folders() {
        if pattern.recent && (folder.hidden || folder.noisy) {
            continue;
        }
        let Some(scope) = folder_scope(pattern, folder, &folder_text) else {
            continue;
        };
        let place = rank::placement_penalty(folder.depth, folder.noisy);
        // How a plain query matches the location, worked out when a file's name first misses.
        let mut located: Option<Option<(Tier, i64)>> = None;
        for (name, file) in folder.files() {
            if since_secs.is_some_and(|since| file.modified_secs < since) {
                continue;
            }
            let age = now_ms.saturating_sub(file.modified_secs.saturating_mul(1000));
            let entry = Entry {
                score: 0,
                secs: file.modified_secs,
                len: fold::nfc_len(name, file.folded.as_deref()),
                root,
                folder: key,
                name,
                file,
                matched: Matched::Nothing,
            };
            if pattern.is_empty() {
                best.push(entry);
                continue;
            }
            let base = rank::recency_boost(age) - place + scope.bonus;
            if pattern.name.is_empty() {
                best.push(Entry {
                    score: Tier::Folder.score() + base,
                    ..entry
                });
                continue;
            }
            let named = file.mask & pattern.mask == pattern.mask;
            if named
                && let Some((tier, range)) =
                    contiguous(pattern, name, file, base, best.floor, &mut words)
            {
                best.push(Entry {
                    score: tier.score() + base,
                    matched: Matched::Range(range),
                    ..entry
                });
                continue;
            }
            // Neither a folder match nor a fuzzy one could still make the cut.
            if best
                .floor
                .is_some_and(|floor| MISSED_NAME_CEILING + base < floor)
            {
                continue;
            }
            let location = *located.get_or_insert_with(|| {
                let location = names::location(key);
                scope
                    .folder
                    .then(|| rank::folder_match(&pattern.name, location, &mut words))
                    .flatten()
            });
            if let Some((Tier::Folder, score)) = location {
                // A folder the query names outranks any fuzzy match of the name.
                best.push(Entry {
                    score: score + base,
                    ..entry
                });
                continue;
            }
            let fallback = location.map(|(_, score)| score + base);
            if named && let Some(pending) = &mut pending {
                let entry = Entry {
                    score: base,
                    ..entry
                };
                pending.add(&mut best, entry, fallback);
            } else if let Some(score) = fallback {
                best.push(Entry { score, ..entry });
            }
        }
    }
    if let Some(pending) = &mut pending {
        pending.score(&mut best);
    }
    best.trim();
    best.entries.sort_by(order);
    best.entries
        .into_iter()
        .filter_map(|entry| {
            let matches = match entry.matched {
                Matched::Nothing => Vec::new(),
                Matched::Range(range) => vec![range],
                Matched::Fuzzy => pending.as_mut().map_or_else(Vec::new, |pending| {
                    pending
                        .fuzzy
                        .ranges(entry.name, entry.file.folded.as_deref())
                }),
            };
            ranked(entry, matches, absolute)
        })
        .collect()
}

/// The contiguous tier of a name whose mask holds the query's, with where it matched.
fn contiguous(
    pattern: &Pattern,
    name: &str,
    file: &File,
    base: i64,
    floor: Option<i64>,
    words: &mut Words,
) -> Option<(Tier, NameRange)> {
    if let (Some(needle), None) = (&pattern.ascii, &file.folded)
        && !may_rank(name, needle, base, floor)
    {
        return None;
    }
    words.fill(name, file.folded.as_deref());
    rank::name_tier(&pattern.name, words)
}

/// Whether an ASCII name can match `needle` contiguously with a score that still counts, read
/// from its bytes alone: without the needle it cannot, and unless it starts with the needle
/// (after any leading separators) it reaches at most the word-start tier.
fn may_rank(name: &str, needle: &[u8], base: i64, floor: Option<i64>) -> bool {
    let bytes = name.trim_start_matches(fold::is_separator).as_bytes();
    if !holds(bytes, needle) {
        return false;
    }
    let prefix = bytes.len() >= needle.len() && bytes[..needle.len()].eq_ignore_ascii_case(needle);
    let tier = if prefix { Tier::Exact } else { Tier::WordStart };
    floor.is_none_or(|floor| tier.score() + base >= floor)
}

/// Whether `needle`, lower case, occurs in `haystack` ignoring case.
fn holds(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.len() >= needle.len()
        && haystack
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
}

/// What a folder means for the files in it.
struct FolderScope {
    /// Added to every file's score: how well a path query's folders matched.
    bonus: i64,
    /// A plain query matches the location, so files whose names miss still rank as folder
    /// matches.
    folder: bool,
}

/// `None` when no file in the folder can match: a path query's folders miss its location.
fn folder_scope(pattern: &Pattern, folder: &Folder, folder_text: &str) -> Option<FolderScope> {
    if !pattern.folders.is_empty() {
        if folder.mask & pattern.folders_mask != pattern.folders_mask {
            return None;
        }
        let bonus = rank::folder_bonus(&pattern.folders, &folder.folded)?;
        return Some(FolderScope {
            bonus,
            folder: false,
        });
    }
    let folder_match = !folder_text.is_empty()
        && folder.mask & pattern.mask == pattern.mask
        && folder.folded.contains(folder_text);
    Some(FolderScope {
        bonus: 0,
        folder: folder_match,
    })
}

fn ranked(
    entry: Entry<'_>,
    matches: Vec<NameRange>,
    absolute: &dyn Fn(&str, &str) -> Option<PathBuf>,
) -> Option<Ranked> {
    let rel = format!("{}/{}", entry.folder, entry.name);
    Some(Ranked {
        candidate: Candidate {
            path: absolute(entry.root, &rel)?,
            name: entry.name.to_owned(),
            location: names::location(entry.folder).to_owned(),
            modified_ms: Some(entry.secs.saturating_mul(1000)),
        },
        score: entry.score,
        matches,
    })
}
