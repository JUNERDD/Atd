//! Node-API binding for `file-index`: a minimal synchronous surface meant to be called from an
//! agent-service `worker_thread`, so blocking calls never stall the service's main event loop.
//! Absolute paths in results are for the service only; it must not pass them to a renderer.

use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
#[derive(Debug)]
pub struct OpenOptions {
    /// Attachable extensions without dots, from the service's attachment rules.
    pub extensions: Vec<String>,
    /// Home folder to index; defaults to `$HOME`. iCloud Drive inside it is indexed as well.
    pub home: Option<String>,
}

#[napi(object)]
#[derive(Debug)]
pub struct QueryHit {
    /// Stable per path across queries and restarts.
    pub id: String,
    pub path: String,
    pub name: String,
    /// Home-relative parent folder, or under `iCloud Drive` ('' = home).
    pub location: String,
    pub score: f64,
    /// Epoch milliseconds.
    pub modified_at: Option<f64>,
    /// Bytes.
    pub size: Option<f64>,
    /// `[from, to)` UTF-16 offsets into `name.normalize('NFC')` where the query matched.
    pub match_start: Option<u32>,
    pub match_end: Option<u32>,
}

#[napi(object)]
#[derive(Debug)]
pub struct IndexStatus {
    /// `idle` | `scanning` | `watching` | `stopped`.
    pub phase: String,
    pub resumed: bool,
    pub scanned_files: f64,
    /// FSEvents ids can exceed 2^53, so the id travels as a decimal string.
    pub last_event_id: String,
    pub skipped_roots: Vec<String>,
    pub error: Option<String>,
}

#[napi]
#[derive(Debug)]
pub struct FileIndex {
    inner: file_index::FileIndex,
}

#[napi]
impl FileIndex {
    /// Opens (or creates) the index stored in `dataDir`.
    #[napi(factory)]
    pub fn open(data_dir: String, options: OpenOptions) -> Result<Self> {
        let home = match options.home {
            Some(home) => PathBuf::from(home),
            None => std::env::var_os("HOME")
                .map(PathBuf::from)
                .ok_or_else(|| Error::from_reason("HOME is not set"))?,
        };
        let index_options = file_index::IndexOptions::home(&home, options.extensions);
        let inner =
            file_index::FileIndex::open(&PathBuf::from(data_dir), index_options).map_err(reason)?;
        Ok(Self { inner })
    }

    /// Starts watching and, when the saved state cannot be resumed, the first walk.
    #[napi]
    pub fn start(&self) -> Result<()> {
        self.inner.start().map_err(reason)
    }

    /// Best matches first; `limit` is clamped to 1-100.
    #[napi]
    pub fn query(&self, text: String, limit: u32) -> Result<Vec<QueryHit>> {
        let hits = self.inner.query(&text, limit as usize).map_err(reason)?;
        Ok(hits
            .into_iter()
            .map(|hit| QueryHit {
                id: hit.id,
                path: hit.path.to_string_lossy().into_owned(),
                name: hit.name,
                location: hit.location,
                score: hit.score as f64,
                modified_at: hit.modified_ms.map(|ms| ms as f64),
                size: hit.size.map(|bytes| bytes as f64),
                match_start: hit.name_match.map(|(from, _)| from),
                match_end: hit.name_match.map(|(_, to)| to),
            })
            .collect())
    }

    #[napi]
    pub fn status(&self) -> IndexStatus {
        let status = self.inner.status();
        let phase = match status.phase {
            file_index::Phase::Idle => "idle",
            file_index::Phase::Scanning => "scanning",
            file_index::Phase::Watching => "watching",
            file_index::Phase::Stopped => "stopped",
        };
        IndexStatus {
            phase: phase.into(),
            resumed: status.resumed,
            scanned_files: status.scanned_files as f64,
            last_event_id: status.last_event_id.to_string(),
            skipped_roots: status
                .skipped_roots
                .iter()
                .map(|root| root.to_string_lossy().into_owned())
                .collect(),
            error: status.error,
        }
    }

    /// Stops background work and saves the resume point. Also runs when the object is collected.
    #[napi]
    pub fn close(&self) -> Result<()> {
        self.inner.close().map_err(reason)
    }
}

fn reason(error: file_index::Error) -> Error {
    Error::from_reason(error.to_string())
}
