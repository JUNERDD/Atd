//! Node-API binding for `file-index`. The calls that block (opening the index, a query that
//! stats its hits, closing) run on libuv's thread pool as promises, so they never stall the
//! caller's event loop; `status` and `start` only take a lock or start a thread and stay
//! synchronous. A query takes an `AbortSignal` that cancels it while it is still queued.
//! Absolute paths in results are for the service only; it must not pass them to a renderer.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

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

impl From<file_index::Hit> for QueryHit {
    fn from(hit: file_index::Hit) -> Self {
        Self {
            id: hit.id,
            path: hit.path.to_string_lossy().into_owned(),
            name: hit.name,
            location: hit.location,
            score: hit.score as f64,
            modified_at: hit.modified_ms.map(|ms| ms as f64),
            size: hit.size.map(|bytes| bytes as f64),
            match_start: hit.name_match.map(|(from, _)| from),
            match_end: hit.name_match.map(|(_, to)| to),
        }
    }
}

/// Where the index is in its life.
#[napi(string_enum = "lowercase")]
#[derive(Debug)]
pub enum Phase {
    /// Opened, `start` not called yet.
    Idle,
    /// The first walk is running; queries see the files found so far.
    Scanning,
    /// Up to date and following file-system events.
    Watching,
    Stopped,
}

impl From<file_index::Phase> for Phase {
    fn from(phase: file_index::Phase) -> Self {
        match phase {
            file_index::Phase::Idle => Self::Idle,
            file_index::Phase::Scanning => Self::Scanning,
            file_index::Phase::Watching => Self::Watching,
            file_index::Phase::Stopped => Self::Stopped,
        }
    }
}

#[napi(object)]
#[derive(Debug)]
pub struct IndexStatus {
    pub phase: Phase,
    pub resumed: bool,
    pub scanned_files: f64,
    /// FSEvents ids can exceed 2^53, so the id travels as a decimal string.
    pub last_event_id: String,
    pub skipped_roots: Vec<String>,
    pub error: Option<String>,
}

/// A blocking call for the thread pool: `work` runs off the JS thread and `finish` turns its
/// output into the promise's value on it.
pub struct Job<T, R> {
    work: Option<Box<dyn FnOnce() -> Result<T> + Send>>,
    finish: fn(T) -> R,
}

impl<T, R> Job<T, R> {
    fn new(work: impl FnOnce() -> Result<T> + Send + 'static, finish: fn(T) -> R) -> Self {
        Self {
            work: Some(Box::new(work)),
            finish,
        }
    }
}

impl<T, R> fmt::Debug for Job<T, R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Job").finish_non_exhaustive()
    }
}

impl<T, R> Task for Job<T, R>
where
    T: Send + 'static,
    R: ToNapiValue + TypeName + 'static,
{
    type Output = T;
    type JsValue = R;

    fn compute(&mut self) -> Result<T> {
        let work = self
            .work
            .take()
            .ok_or_else(|| Error::from_reason("the task already ran"))?;
        work()
    }

    fn resolve(&mut self, _env: Env, output: T) -> Result<R> {
        Ok((self.finish)(output))
    }
}

#[napi]
#[derive(Debug)]
pub struct FileIndex {
    inner: Arc<file_index::FileIndex>,
}

#[napi]
impl FileIndex {
    /// Opens (or creates) the index stored in `dataDir`. Loading a large saved index takes a
    /// moment, hence a promise.
    #[napi(ts_return_type = "Promise<FileIndex>")]
    pub fn open(
        data_dir: String,
        options: OpenOptions,
    ) -> AsyncTask<Job<file_index::FileIndex, FileIndex>> {
        AsyncTask::new(Job::new(
            move || {
                let home = match options.home {
                    Some(home) => PathBuf::from(home),
                    None => std::env::var_os("HOME")
                        .map(PathBuf::from)
                        .ok_or_else(|| Error::from_reason("HOME is not set"))?,
                };
                let index_options = file_index::IndexOptions::home(&home, options.extensions);
                file_index::FileIndex::open(&PathBuf::from(data_dir), index_options).map_err(reason)
            },
            |inner| FileIndex {
                inner: Arc::new(inner),
            },
        ))
    }

    /// Starts watching and, when the saved state cannot be resumed, the first walk in the
    /// background. Returns once the event stream runs.
    #[napi]
    pub fn start(&self) -> Result<()> {
        self.inner.start().map_err(reason)
    }

    /// Best matches first; `limit` is clamped to 1-100. Aborting `signal` rejects with an
    /// `AbortError` while the query is still queued; a query that already runs finishes.
    #[napi(ts_return_type = "Promise<Array<QueryHit>>")]
    pub fn query(
        &self,
        text: String,
        limit: u32,
        signal: Option<AbortSignal>,
    ) -> AsyncTask<Job<Vec<file_index::Hit>, Vec<QueryHit>>> {
        let inner = Arc::clone(&self.inner);
        AsyncTask::with_optional_signal(
            Job::new(
                move || inner.query(&text, limit as usize).map_err(reason),
                |hits| hits.into_iter().map(QueryHit::from).collect(),
            ),
            signal,
        )
    }

    #[napi]
    pub fn status(&self) -> IndexStatus {
        let status = self.inner.status();
        IndexStatus {
            phase: status.phase.into(),
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
    #[napi(ts_return_type = "Promise<void>")]
    pub fn close(&self) -> AsyncTask<Job<(), ()>> {
        let inner = Arc::clone(&self.inner);
        AsyncTask::new(Job::new(move || inner.close().map_err(reason), |()| ()))
    }
}

fn reason(error: file_index::Error) -> Error {
    Error::from_reason(error.to_string())
}
