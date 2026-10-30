//! The index's background work: the first walk, applying event batches, and saving progress.
//!
//! Store writes and the resume point become durable together in `flush`: at most every
//! `FLUSH_EVERY` while files change, every `IDLE_FLUSH_EVERY` while only the event id moves on
//! (most events lie in folders the index never covers), and always at the end of the first walk
//! and at close. A crash in between loses no change, only progress: the saved event id never
//! runs ahead of the durable store, so the next start replays the rest.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::engine::{Shared, lock};
use crate::plan::{self, Filter, RawEvent};
use crate::reconcile;
use crate::state;
use crate::walk::Focus;
use crate::{Error, Phase};

const FLUSH_EVERY: Duration = Duration::from_secs(30);
const IDLE_FLUSH_EVERY: Duration = Duration::from_secs(10 * 60);
/// How often `follow` wakes without events, to flush on time.
const POLL: Duration = Duration::from_millis(250);

/// What the event stream applied since the state was last saved.
#[derive(Debug)]
pub(crate) struct Progress {
    /// Every event up to this id is reflected in the store, durable or not.
    pub applied_id: u64,
    /// The store changed since it was last made durable.
    pub dirty: bool,
    pub flushed: Instant,
}

/// Runs `work` on a named thread. A panic there counts as a background failure, so the phase
/// never stays at scanning or replaying for good.
pub(crate) fn spawn(
    shared: Arc<Shared>,
    name: &str,
    work: impl FnOnce(&Shared) + Send + 'static,
) -> Result<JoinHandle<()>, Error> {
    std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            if catch_unwind(AssertUnwindSafe(|| work(&shared))).is_err() {
                shared.fail(&Error::Internal(
                    "the index's background work stopped".into(),
                ));
            }
        })
        .map_err(Error::Io)
}

impl Shared {
    /// The first walk. On completion the store holds every root as of the walk, and every event
    /// since `from` is either applied or still queued, so the resume point becomes valid.
    pub(crate) fn scan(&self, from: u64) {
        for root in 0..self.scope.roots.len() {
            let walked = reconcile::write_walk(
                &self.scope,
                self.store.as_ref(),
                root,
                Focus::All,
                &self.stop,
            );
            match walked {
                Ok(applied) => self.update_status(|status| status.scanned_files += applied.written),
                Err(error) => return self.fail(&error),
            }
            if self.stop.load(Ordering::Relaxed) {
                // Cut short: the state stays incomplete, so the next open walks again.
                return;
            }
        }
        // Read before the checkpoint, which makes everything applied by then durable.
        let applied = lock(&self.progress).applied_id;
        let completed = self
            .store
            .checkpoint()
            .and_then(|()| self.store.compact_names())
            .map_err(Error::from)
            .and_then(|()| self.save_progress(from.max(applied), true));
        match completed {
            Ok(()) => self.move_phase(&[Phase::Scanning], Phase::Watching),
            Err(error) => self.fail(&error),
        }
    }

    /// Applies event batches until the stream ends, flushing on time. Batches that arrive
    /// together are merged, so a burst of changes costs one plan.
    pub(crate) fn follow(&self, receiver: &Receiver<Vec<RawEvent>>) {
        loop {
            match receiver.recv_timeout(POLL) {
                Ok(mut events) => {
                    while let Ok(more) = receiver.try_recv() {
                        events.extend(more);
                    }
                    if self.stop.load(Ordering::Relaxed) {
                        // The unapplied events stay after the saved id and are replayed next time.
                        return;
                    }
                    self.apply(&events);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if let Err(error) = self.flush() {
                self.fail(&error);
            }
        }
    }

    fn apply(&self, events: &[RawEvent]) {
        let scope = &self.scope;
        let is_root = |path: &Path| scope.roots.iter().any(|root| root.path == path);
        let filter = Filter {
            never_indexed: &|path, is_dir| scope.never_indexed(path, is_dir),
            is_root: &is_root,
        };
        let plan = plan::plan(events, &filter);
        // Rebuilding a root empties it first: its files are missing until the walk ends.
        let empties_root = plan.rescan_all
            || plan.subtrees.iter().any(|subtree| {
                scope
                    .roots
                    .iter()
                    .any(|root| root.path.starts_with(subtree))
            });
        let before = lock(&self.status).phase;
        if empties_root {
            self.move_phase(&[Phase::Watching, Phase::Replaying], Phase::Scanning);
        }
        match reconcile::apply(scope, self.store.as_ref(), &plan, &self.stop) {
            Ok(applied) => {
                self.update_status(|status| status.scanned_files += applied.written);
                lock(&self.progress).dirty |= applied.changed;
            }
            Err(error) => {
                // Keep draining; the saved state is incomplete now, so nothing is resumed.
                return self.fail(&error);
            }
        }
        if self.stop.load(Ordering::Relaxed) {
            // A stop cut the walks short: this batch is not fully applied.
            return;
        }
        if let Some(last) = plan.last_id {
            let mut progress = lock(&self.progress);
            progress.applied_id = progress.applied_id.max(last);
        }
        if empties_root && matches!(before, Phase::Watching | Phase::Replaying) {
            self.move_phase(&[Phase::Scanning], before);
        }
        if plan.history_done {
            // The events recorded while the index was closed are all applied now.
            self.move_phase(&[Phase::Replaying], Phase::Watching);
        }
    }

    /// Makes changed store writes durable, then saves the resume point covering them, once
    /// enough time has passed since the last flush.
    fn flush(&self) -> Result<(), Error> {
        let mut progress = lock(&self.progress);
        let behind = progress.applied_id > lock(&self.saved).last_event_id;
        let wait = if progress.dirty {
            FLUSH_EVERY
        } else {
            IDLE_FLUSH_EVERY
        };
        if !(progress.dirty || behind) || progress.flushed.elapsed() < wait {
            return Ok(());
        }
        if progress.dirty {
            self.store.persist()?;
            progress.dirty = false;
        }
        let applied = progress.applied_id;
        progress.flushed = Instant::now();
        drop(progress);
        self.save_progress(applied, false)
    }

    /// Saves the resume point at `applied` once the store is durable up to it; `complete` marks
    /// the first walk done. A failure in this process keeps the state incomplete.
    fn save_progress(&self, applied: u64, complete: bool) -> Result<(), Error> {
        let mut saved = lock(&self.saved);
        if self.failed.load(Ordering::SeqCst) {
            return Ok(());
        }
        saved.scan_complete |= complete;
        if !saved.scan_complete || (applied <= saved.last_event_id && !complete) {
            return Ok(());
        }
        saved.last_event_id = saved.last_event_id.max(applied);
        state::save(&self.state_path, &saved)?;
        let last = saved.last_event_id;
        drop(saved);
        self.update_status(|status| status.last_event_id = last);
        Ok(())
    }

    /// The final flush at close, once the background threads have ended.
    pub(crate) fn finish(&self) -> Result<(), Error> {
        self.store.checkpoint()?;
        let applied = lock(&self.progress).applied_id;
        let mut saved = lock(&self.saved);
        if saved.scan_complete && !self.failed.load(Ordering::SeqCst) {
            saved.last_event_id = saved.last_event_id.max(applied);
        }
        state::save(&self.state_path, &saved)?;
        Ok(())
    }

    fn move_phase(&self, from: &[Phase], to: Phase) {
        self.update_status(|status| {
            if from.contains(&status.phase) {
                status.phase = to;
            }
        });
    }

    /// Records a background failure and marks the saved state incomplete: the store may have
    /// missed changes, so the next open rebuilds it. Queries keep answering from the store.
    pub(crate) fn fail(&self, error: &Error) {
        self.failed.store(true, Ordering::SeqCst);
        let mut saved = lock(&self.saved);
        saved.scan_complete = false;
        let _ = state::save(&self.state_path, &saved);
        drop(saved);
        self.update_status(|status| {
            status.error = Some(error.to_string());
            if status.phase != Phase::Stopped {
                status.phase = Phase::Failed;
            }
        });
    }
}
