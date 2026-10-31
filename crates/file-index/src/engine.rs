use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Instant;

use crate::background::{self, Progress};
use crate::fsevents::{self, EventStream};
use crate::scope::Scope;
use crate::state::{self, Identity, SavedState, StartPoint};
use crate::store::{MinidexStore, NameStore};
use crate::{Error, Extensions, Hit, IndexOptions, Phase, Status};

/// Names the store's on-disk layout and coverage in the saved identity; a change rebuilds the
/// index. The `minidex` part is the release that last changed minidex's file format, not the
/// pinned version: 0.37.0 and 0.39.0 read 0.36.0's segments and write-ahead log unchanged, so
/// those bumps kept existing indexes. Change it when a minidex release alters its format, when
/// the stored paths or times change, or when the rules for what is indexed do (`work-trees`:
/// everything git keeps inside work trees).
const STORE_FORMAT: &str = "minidex=0.36.0;paths=display;time=micros;scope=work-trees";
const STORE_DIR: &str = "names";
const STATE_FILE: &str = "state.json";

/// The file index: open it, `start` it, then `query` from any thread. Dropping it stops the
/// background work and saves the resume point.
#[derive(Debug)]
pub struct FileIndex {
    pub(crate) shared: Arc<Shared>,
    workers: Mutex<Option<Workers>>,
}

#[derive(Debug)]
pub(crate) struct Shared {
    pub scope: Arc<Scope>,
    pub store: Box<dyn NameStore>,
    start_point: StartPoint,
    /// What `state.json` holds.
    pub saved: Mutex<SavedState>,
    /// What the event stream applied since the state was last saved.
    pub progress: Mutex<Progress>,
    pub status: Mutex<Status>,
    pub stop: AtomicBool,
    /// A background failure happened, so the store may have missed changes: the saved state is
    /// not marked resumable again while this process runs.
    pub failed: AtomicBool,
    pub state_path: PathBuf,
}

#[derive(Debug)]
struct Workers {
    stream: EventStream,
    threads: Vec<JoinHandle<()>>,
}

impl FileIndex {
    /// Opens the index kept in `data_dir`, creating it when missing. A store built for other
    /// roots, extensions, coverage rules or event history is discarded here; `start` then
    /// rebuilds it.
    pub fn open(data_dir: &Path, options: IndexOptions) -> Result<Self, Error> {
        std::fs::create_dir_all(data_dir)?;
        let extensions = Extensions::new(&options.extensions)?;
        let scope = Scope::new(options.roots, extensions, data_dir.canonicalize().ok())?;
        let identity = Identity {
            store: STORE_FORMAT.into(),
            extensions: scope.extensions.to_vec(),
            roots: scope.roots.iter().map(|root| root.key()).collect(),
            volumes: scope
                .roots
                .iter()
                .map(|root| fsevents::volume_uuid(&root.path).unwrap_or_default())
                .collect(),
        };
        let state_path = data_dir.join(STATE_FILE);
        let loaded = state::load(&state_path);
        let start_point = state::start_point(loaded.as_ref(), &identity);
        let saved = match (start_point, loaded) {
            (StartPoint::Resume { .. }, Some(saved)) => saved,
            _ => {
                // Mark the state incomplete before discarding the store, so a crash in between
                // can never pair an old event id with an emptied store.
                let fresh = SavedState::new(identity);
                state::save(&state_path, &fresh)?;
                match std::fs::remove_dir_all(data_dir.join(STORE_DIR)) {
                    Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                        return Err(error.into());
                    }
                    _ => {}
                }
                fresh
            }
        };
        let store = MinidexStore::open(&data_dir.join(STORE_DIR))?;
        let status = Status {
            phase: Phase::Idle,
            resumed: false,
            scanned_files: 0,
            last_event_id: saved.last_event_id,
            skipped_roots: scope.skipped_roots.clone(),
            error: None,
        };
        let progress = Progress {
            applied_id: saved.last_event_id,
            dirty: false,
            flushed: Instant::now(),
        };
        let shared = Shared {
            scope: Arc::new(scope),
            store: Box::new(store),
            start_point,
            saved: Mutex::new(saved),
            progress: Mutex::new(progress),
            status: Mutex::new(status),
            stop: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            state_path,
        };
        Ok(Self {
            shared: Arc::new(shared),
            workers: Mutex::new(None),
        })
    }

    /// Starts following file-system events and, unless the saved state allows resuming, walks
    /// every root. Returns once the event stream runs; the walk, or the replay of the events
    /// recorded while the index was closed, continues in the background. Calling it again while
    /// running does nothing.
    pub fn start(&self) -> Result<(), Error> {
        let mut workers = lock(&self.workers);
        if workers.is_some() {
            return Ok(());
        }
        let shared = &self.shared;
        if shared.stop.load(Ordering::Relaxed) {
            return Err(Error::Closed);
        }
        let paths: Vec<PathBuf> = shared
            .scope
            .roots
            .iter()
            .map(|root| root.path.clone())
            .collect();
        let (sender, receiver) = mpsc::channel();
        let mut threads = Vec::new();
        let stream = match shared.start_point {
            StartPoint::Resume { since } => {
                let stream = EventStream::start(&paths, Some(since), sender)?;
                shared.update_status(|status| {
                    status.phase = Phase::Replaying;
                    status.resumed = true;
                });
                stream
            }
            StartPoint::Rebuild => {
                // Events from this id on are replayed, so nothing changed during the walk is lost.
                let from = fsevents::current_event_id();
                let stream = EventStream::start(&paths, Some(from), sender)?;
                shared.update_status(|status| status.phase = Phase::Scanning);
                let scanner = Arc::clone(shared);
                threads.push(background::spawn(
                    scanner,
                    "file-index-scan",
                    move |shared| {
                        shared.scan(from);
                    },
                )?);
                stream
            }
        };
        let follower = Arc::clone(shared);
        threads.push(background::spawn(
            follower,
            "file-index-sync",
            move |shared| {
                shared.follow(&receiver);
            },
        )?);
        *workers = Some(Workers { stream, threads });
        Ok(())
    }

    pub fn status(&self) -> Status {
        lock(&self.shared.status).clone()
    }

    /// Searches file names, best first, at most `limit` (1-100) results.
    pub fn query(&self, text: &str, limit: usize) -> Result<Vec<Hit>, Error> {
        crate::query::query(&self.shared, text, limit)
    }

    /// Stops background work, makes every write durable and saves the resume point. Queries
    /// keep answering from the store until the index is dropped. Later calls do nothing.
    pub fn close(&self) -> Result<(), Error> {
        if self.shared.stop.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if let Some(workers) = lock(&self.workers).take() {
            // Dropping the stream joins its thread and frees its sender, ending `follow`.
            drop(workers.stream);
            for thread in workers.threads {
                let _ = thread.join();
            }
        }
        let result = self.shared.finish();
        self.shared
            .update_status(|status| status.phase = Phase::Stopped);
        result
    }
}

impl Drop for FileIndex {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

impl Shared {
    pub(crate) fn update_status(&self, change: impl FnOnce(&mut Status)) {
        change(&mut lock(&self.status));
    }
}

/// Locks, recovering from poisoning: every guarded value stays consistent between statements.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
