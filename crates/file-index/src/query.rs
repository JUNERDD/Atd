use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::engine::Shared;
use crate::pattern::Pattern;
use crate::{Error, Hit, search};

const MAX_LIMIT: usize = 100;
/// Empty and one-ASCII-character queries list files modified within this window, as the earlier
/// Spotlight backend's "recently modified" pass did. The index keeps no usage dates.
const RECENT_WINDOW_SECS: u64 = 3 * 24 * 60 * 60;

pub(crate) fn query(shared: &Shared, text: &str, limit: usize) -> Result<Vec<Hit>, Error> {
    let limit = limit.clamp(1, MAX_LIMIT);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let scope = &shared.scope;
    let keys: Vec<String> = scope.roots.iter().map(|root| root.key()).collect();
    let roots: Vec<(&str, &str)> = keys
        .iter()
        .zip(&scope.roots)
        .map(|(key, root)| (key.as_str(), root.label.as_str()))
        .collect();
    let pattern = Pattern::parse(text, &roots);
    let since = pattern
        .recent
        .then(|| now.as_secs().saturating_sub(RECENT_WINDOW_SECS));
    let absolute = |root: &str, rel: &str| {
        let root = scope.root_by_key(root)?;
        Some(scope.absolute(root, rel))
    };
    // A few more than asked for: files deleted since they were indexed are skipped below.
    let keep = limit + limit / 2 + 8;
    let mut ranked = Vec::new();
    shared.store.read_names(&mut |names| {
        ranked = search::search(
            names,
            &pattern,
            since,
            now.as_millis() as u64,
            keep,
            &absolute,
        );
    });
    // Stats run after the name list is released, so writers never wait on the disk here.
    let mut hits = Vec::with_capacity(limit);
    for entry in ranked {
        if hits.len() == limit {
            break;
        }
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
            matches: entry.matches,
        });
    }
    Ok(hits)
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
