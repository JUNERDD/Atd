use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::engine::Shared;
use crate::fold::fold_text;
use crate::rank::{self, Candidate, Ranked};
use crate::store::StoredFile;
use crate::{Error, Hit};

/// Store matches handed to ranking per query. Ranking and the tier filter then keep the best.
const CANDIDATE_CAP: usize = 500;
const MAX_LIMIT: usize = 100;
/// Empty and one-character queries list files modified within this window, as the current
/// Spotlight backend's "recently modified" pass does. The index keeps no usage dates.
const RECENT_WINDOW_SECS: u64 = 3 * 24 * 60 * 60;

pub(crate) fn query(shared: &Shared, text: &str, limit: usize) -> Result<Vec<Hit>, Error> {
    let limit = limit.clamp(1, MAX_LIMIT);
    let text = text.trim();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let now_ms = now.as_millis() as u64;
    let short = fold_text(text).len() <= 1;
    let stored = if short {
        let since = now.as_secs().saturating_sub(RECENT_WINDOW_SECS);
        shared.store.recent(since, CANDIDATE_CAP)?
    } else {
        shared.store.candidates(text, CANDIDATE_CAP)?
    };
    let candidates = stored
        .into_iter()
        .filter_map(|file| candidate(shared, file))
        .collect();
    let mut ranked = rank::rank(text, candidates, now_ms);
    if !short && ranked.len() < limit {
        ranked = with_mid_word_matches(shared, text, ranked, now_ms)?;
    }
    let mut hits = Vec::with_capacity(limit);
    for entry in ranked {
        if hits.len() == limit {
            break;
        }
        // Read fresh metadata; a file removed since it was indexed is skipped.
        let Ok(metadata) = std::fs::metadata(&entry.candidate.path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|age| age.as_millis() as u64)
            .or(entry.candidate.modified_ms);
        hits.push(Hit {
            id: stable_id(&entry.candidate.path),
            path: entry.candidate.path,
            name: entry.candidate.name,
            location: entry.candidate.location,
            score: entry.score,
            modified_ms,
            size: Some(metadata.len()),
            name_match: entry.name_match,
        });
    }
    Ok(hits)
}

/// Adds the names that contain the query mid-word, which the word index cannot find (R10), and
/// ranks again. They can only reach the substring tier, so every name that matched at a word
/// start keeps its place above them.
fn with_mid_word_matches(
    shared: &Shared,
    text: &str,
    ranked: Vec<Ranked>,
    now_ms: u64,
) -> Result<Vec<Ranked>, Error> {
    let mut candidates: Vec<Candidate> = ranked.into_iter().map(|entry| entry.candidate).collect();
    let seen: HashSet<PathBuf> = candidates.iter().map(|entry| entry.path.clone()).collect();
    let extra = shared.store.containing(text, CANDIDATE_CAP)?;
    candidates.extend(
        extra
            .into_iter()
            .filter_map(|file| candidate(shared, file))
            .filter(|entry| !seen.contains(&entry.path)),
    );
    Ok(rank::rank(text, candidates, now_ms))
}

fn candidate(shared: &Shared, file: StoredFile) -> Option<Candidate> {
    let root = shared.scope.root_by_key(&file.root)?;
    let (folder, name) = file.rel.rsplit_once('/')?;
    Some(Candidate {
        path: shared.scope.absolute(root, &file.rel),
        name: name.to_owned(),
        location: folder.trim_start_matches('/').to_owned(),
        modified_ms: Some(file.modified_secs.saturating_mul(1000)),
    })
}

/// FNV-1a 64 of the path bytes: stable across processes and Rust versions, unlike `Hash`.
fn stable_id(path: &Path) -> String {
    use std::os::unix::ffi::OsStrExt;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_os_str().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_and_distinct() {
        let id = stable_id(Path::new("/Users/a/notes.md"));
        assert_eq!(id, stable_id(Path::new("/Users/a/notes.md")));
        assert_ne!(id, stable_id(Path::new("/Users/a/notes.txt")));
        assert_eq!(stable_id(Path::new("")), "cbf29ce484222325");
    }
}
