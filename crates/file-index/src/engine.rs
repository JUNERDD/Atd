use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::fsevents::{self, EventStream};
use crate::plan::{self, RawEvent};
use crate::scope::Scope;
use crate::state::{self, Identity, SavedState, StartPoint};
use crate::store::{MinidexStore, NameStore};
use crate::walk::Focus;
use crate::{Error, Extensions, Hit, IndexOptions, Phase, Status, reconcile};

/// Names the store implementation and version in the saved identity; a change rebuilds.
const STORE_FORMAT: &str = "minidex=0.36.0;paths=display";
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
    saved: Mutex<SavedState>,
    status: Mutex<Status>,
    stop: AtomicBool,
    state_path: PathBuf,
}

#[derive(Debug)]
struct Workers {
    stream: EventStream,
    threads: Vec<JoinHandle<()>>,
}

impl FileIndex {
    /// Opens the index kept in `data_dir`, creating it when missing. A store built for other
    /// roots, extensions or event history is discarded here; `start` then rebuilds it.
    pub fn open(data_dir: &Path, options: IndexOptions) -> Result<Self, Error> {
        let extensions = Extensions::new(&options.extensions)?;
        let scope = Scope::new(options.roots, extensions)?;
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
        std::fs::create_dir_all(data_dir)?;
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
        let shared = Shared {
            scope: Arc::new(scope),
            store: Box::new(store),
            start_point,
            saved: Mutex::new(saved),
            status: Mutex::new(status),
            stop: AtomicBool::new(false),
            state_path,
        };
        Ok(Self {
            shared: Arc::new(shared),
            workers: Mutex::new(None),
        })
    }

    /// Starts following file-system events and, unless the saved state allows resuming, walks
    /// every root. Returns once the event stream runs; the walk continues in the background.
    /// Calling it again while running does nothing.
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
                shared.update_status(|status| {
                    status.phase = Phase::Watching;
                    status.resumed = true;
                });
                EventStream::start(&paths, Some(since), sender)?
            }
            StartPoint::Rebuild => {
                // Events from this id on are replayed, so nothing changed during the walk is lost.
                let from = fsevents::current_event_id();
                let stream = EventStream::start(&paths, Some(from), sender)?;
                shared.update_status(|status| status.phase = Phase::Scanning);
                let scanner = Arc::clone(shared);
                threads.push(spawn("file-index-scan", move || scanner.scan(from))?);
                stream
            }
        };
        let follower = Arc::clone(shared);
        threads.push(spawn("file-index-sync", move || {
            follower.follow(&receiver)
        })?);
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
    /// keep answering from the store until the index is dropped.
    pub fn close(&self) -> Result<(), Error> {
        self.shared.stop.store(true, Ordering::Relaxed);
        if let Some(workers) = lock(&self.workers).take() {
            // Dropping the stream joins its thread and frees its sender, ending `follow`.
            drop(workers.stream);
            for thread in workers.threads {
                let _ = thread.join();
            }
        }
        self.shared.store.checkpoint()?;
        state::save(&self.shared.state_path, &lock(&self.shared.saved))?;
        self.shared
            .update_status(|status| status.phase = Phase::Stopped);
        Ok(())
    }
}

impl Drop for FileIndex {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

impl Shared {
    fn update_status(&self, change: impl FnOnce(&mut Status)) {
        change(&mut lock(&self.status));
    }

    /// The first walk. On completion the store holds every root as of the walk, and every event
    /// since `from` is either applied or still queued, so the resume point becomes valid.
    fn scan(&self, from: u64) {
        let mut complete = true;
        for root in 0..self.scope.roots.len() {
            match reconcile::write_walk(
                &self.scope,
                self.store.as_ref(),
                root,
                Focus::All,
                &self.stop,
            ) {
                Ok(written) => self.update_status(|status| status.scanned_files += written),
                Err(error) => return self.fail(&error),
            }
            complete &= !self.stop.load(Ordering::Relaxed);
        }
        if !complete {
            return;
        }
        if let Err(error) = self.store.checkpoint() {
            return self.fail(&error.into());
        }
        let mut saved = lock(&self.saved);
        saved.scan_complete = true;
        saved.last_event_id = saved.last_event_id.max(from);
        let result = state::save(&self.state_path, &saved);
        let last = saved.last_event_id;
        drop(saved);
        match result {
            Ok(()) => self.update_status(|status| {
                status.phase = Phase::Watching;
                status.last_event_id = last;
            }),
            Err(error) => self.fail(&error.into()),
        }
    }

    /// Applies event batches until the stream ends. Batches that arrive together are merged, so
    /// a burst of changes costs one plan.
    fn follow(&self, receiver: &Receiver<Vec<RawEvent>>) {
        loop {
            let mut events = match receiver.recv_timeout(Duration::from_millis(250)) {
                Ok(events) => events,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return,
            };
            while let Ok(more) = receiver.try_recv() {
                events.extend(more);
            }
            if self.stop.load(Ordering::Relaxed) {
                // The unapplied events stay after the saved id and are replayed next time.
                return;
            }
            let plan = plan::plan(&events);
            match reconcile::apply(&self.scope, self.store.as_ref(), &plan, &self.stop) {
                Ok(written) => self.update_status(|status| status.scanned_files += written),
                Err(error) => {
                    // Keep draining; the saved state is incomplete now, so nothing is resumed.
                    self.fail(&error);
                    continue;
                }
            }
            if self.stop.load(Ordering::Relaxed) {
                // A stop cut the walks short: this batch is not fully applied.
                return;
            }
            let Some(last) = plan.last_id else { continue };
            let mut saved = lock(&self.saved);
            saved.last_event_id = saved.last_event_id.max(last);
            let result = if saved.scan_complete {
                state::save(&self.state_path, &saved)
            } else {
                Ok(())
            };
            drop(saved);
            match result {
                Ok(()) => self.update_status(|status| status.last_event_id = last),
                Err(error) => self.fail(&error.into()),
            }
        }
    }

    /// Records a background failure and marks the saved state incomplete: the store may have
    /// missed changes, so the next open rebuilds it.
    fn fail(&self, error: &Error) {
        let mut saved = lock(&self.saved);
        saved.scan_complete = false;
        let _ = state::save(&self.state_path, &saved);
        drop(saved);
        self.update_status(|status| status.error = Some(error.to_string()));
    }
}

fn spawn(name: &str, work: impl FnOnce() + Send + 'static) -> Result<JoinHandle<()>, Error> {
    std::thread::Builder::new()
        .name(name.into())
        .spawn(work)
        .map_err(Error::Io)
}

/// Locks, recovering from poisoning: every guarded value stays consistent between statements.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
