//! FSEvents through `objc2-core-services`, chosen over `notify` because resuming needs event ids:
//! notify 8.2.0 always starts its stream at `kFSEventStreamEventIdSinceNow` and drops the ids
//! its callback receives, so a restart could not replay what happened while the app was closed.
//!
//! The stream is delivered on its own serial dispatch queue (the run-loop scheduling calls are
//! deprecated), so no thread of ours polls or owns a run loop.

use std::ffi::{CStr, OsString, c_char, c_void};
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::MetadataExt;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::mpsc::Sender;

use dispatch2::{DispatchQueue, DispatchRetained};
use objc2_core_foundation::{CFArray, CFString, CFUUID};
use objc2_core_services as fs;

use crate::Error;
use crate::plan::{RawEvent, flags};

const _: () = {
    assert!(flags::MUST_SCAN_SUB_DIRS == fs::kFSEventStreamEventFlagMustScanSubDirs);
    assert!(flags::EVENT_IDS_WRAPPED == fs::kFSEventStreamEventFlagEventIdsWrapped);
    assert!(flags::HISTORY_DONE == fs::kFSEventStreamEventFlagHistoryDone);
    assert!(flags::ROOT_CHANGED == fs::kFSEventStreamEventFlagRootChanged);
    assert!(flags::MOUNT == fs::kFSEventStreamEventFlagMount);
    assert!(flags::UNMOUNT == fs::kFSEventStreamEventFlagUnmount);
    assert!(flags::ITEM_CREATED == fs::kFSEventStreamEventFlagItemCreated);
    assert!(flags::ITEM_REMOVED == fs::kFSEventStreamEventFlagItemRemoved);
    assert!(flags::ITEM_RENAMED == fs::kFSEventStreamEventFlagItemRenamed);
    assert!(flags::ITEM_IS_DIR == fs::kFSEventStreamEventFlagItemIsDir);
};

/// Seconds FSEvents waits to coalesce changes before delivering them.
const LATENCY_SECONDS: f64 = 0.5;

/// The id of the newest event recorded on this Mac.
pub(crate) fn current_event_id() -> u64 {
    // SAFETY: a plain query without arguments.
    unsafe { fs::FSEventsGetCurrentEventId() }
}

/// The FSEvents database UUID of the volume holding `path`; `None` when the volume keeps no
/// event history (then no id from it can be replayed).
pub(crate) fn volume_uuid(path: &Path) -> Option<String> {
    let device = std::fs::metadata(path).ok()?.dev() as libc::dev_t;
    // SAFETY: any device number is accepted; the returned UUID is owned and released on drop.
    let uuid = unsafe { fs::FSEventsCopyUUIDForDevice(device) }?;
    CFUUID::new_string(None, Some(&uuid)).map(|text| text.to_string())
}

/// The raw stream pointer, movable into the closure that stops it on its queue.
#[derive(Debug)]
struct StreamPtr(fs::FSEventStreamRef);

// SAFETY: the pointer is only dereferenced inside `EventStream::drop`, serialised on the
// stream's own queue, and by FSEvents itself; nothing is shared through `&EventStream`.
unsafe impl Send for StreamPtr {}

/// A running event stream over some folders. Batches go to the sender from a serial dispatch
/// queue that the stream owns; dropping the value stops the stream on that queue and frees the
/// sender, so the receiver then sees a disconnect.
///
/// Dropping must never happen on the stream's own queue (that is, from inside the callback):
/// it waits for that queue and would deadlock. The callback only sends, so it never does.
#[derive(Debug)]
pub(crate) struct EventStream {
    stream: StreamPtr,
    queue: DispatchRetained<DispatchQueue>,
}

impl EventStream {
    /// Starts delivering events after `since` (`None`: from now on).
    pub fn start(
        paths: &[PathBuf],
        since: Option<u64>,
        sender: Sender<Vec<RawEvent>>,
    ) -> Result<Self, Error> {
        let strings = paths
            .iter()
            .map(|path| {
                path.to_str().map(CFString::from_str).ok_or_else(|| {
                    Error::Watch(format!(
                        "a root path is not valid UTF-8: {}",
                        path.display()
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let array = CFArray::from_retained_objects(&strings);
        let mut context = fs::FSEventStreamContext {
            version: 0,
            info: Box::into_raw(Box::new(sender)).cast::<c_void>(),
            retain: None,
            release: Some(release_sender),
            copyDescription: None,
        };
        let create_flags =
            fs::kFSEventStreamCreateFlagFileEvents | fs::kFSEventStreamCreateFlagWatchRoot;
        // SAFETY: FSEvents copies the context and the path array, so both may go out of scope
        // after the call; `info` is then owned by the stream, which frees it through
        // `release_sender` when it is deallocated.
        let stream = unsafe {
            fs::FSEventStreamCreate(
                None,
                Some(callback),
                &mut context,
                array.as_opaque(),
                since.unwrap_or(fs::kFSEventStreamEventIdSinceNow),
                LATENCY_SECONDS,
                create_flags,
            )
        };
        if stream.is_null() {
            // SAFETY: creation failed, so the stream never took ownership of `info`.
            unsafe { release_sender(context.info) };
            return Err(Error::Watch("FSEventStreamCreate failed".into()));
        }
        let queue = DispatchQueue::new("file-index-events", None);
        // Owned from here: a failed start still stops, invalidates and releases it in `drop`.
        let this = Self {
            stream: StreamPtr(stream),
            queue,
        };
        // SAFETY: a freshly created stream, scheduled once on a queue it keeps alive.
        let started = unsafe {
            fs::FSEventStreamSetDispatchQueue(stream, Some(&this.queue));
            fs::FSEventStreamStart(stream)
        };
        if started {
            Ok(this)
        } else {
            Err(Error::Watch("FSEventStreamStart failed".into()))
        }
    }
}

impl Drop for EventStream {
    fn drop(&mut self) {
        let stream = StreamPtr(self.stream.0);
        // Runs on the stream's serial queue, after any callback in flight has returned.
        self.queue.exec_sync(move || {
            let stream = stream;
            // SAFETY: stop, invalidate and release exactly once each, in the order FSEvents
            // requires; the release deallocates the stream and frees the sender.
            unsafe {
                fs::FSEventStreamStop(stream.0);
                fs::FSEventStreamInvalidate(stream.0);
                fs::FSEventStreamRelease(stream.0);
            }
        });
    }
}

/// The stream's `release` hook for `info`: runs when the stream is deallocated, when no
/// callback can run any more.
unsafe extern "C-unwind" fn release_sender(info: *const c_void) {
    // SAFETY: `info` is the box made in `start`, released exactly once.
    drop(unsafe { Box::from_raw(info.cast_mut().cast::<Sender<Vec<RawEvent>>>()) });
}

unsafe extern "C-unwind" fn callback(
    _stream: fs::ConstFSEventStreamRef,
    info: *mut c_void,
    count: usize,
    paths: NonNull<c_void>,
    event_flags: NonNull<fs::FSEventStreamEventFlags>,
    event_ids: NonNull<fs::FSEventStreamEventId>,
) {
    // A panic must not unwind into FSEvents' frames, and a dropped batch would silently skip
    // changes the saved event id then claims to include.
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: FSEvents passes `count` C strings (no `UseCFTypes` flag), flags and ids, valid
        // for the duration of the call; `info` is the boxed sender, alive until the stream is
        // released, which waits for this queue.
        let (sender, events) = unsafe {
            let sender = &*info.cast::<Sender<Vec<RawEvent>>>();
            let paths = std::slice::from_raw_parts(paths.as_ptr().cast::<*const c_char>(), count);
            let event_flags = std::slice::from_raw_parts(event_flags.as_ptr(), count);
            let event_ids = std::slice::from_raw_parts(event_ids.as_ptr(), count);
            let events: Vec<RawEvent> = (0..count)
                .map(|index| RawEvent {
                    path: PathBuf::from(OsString::from_vec(
                        CStr::from_ptr(paths[index]).to_bytes().to_vec(),
                    )),
                    flags: event_flags[index],
                    id: event_ids[index],
                })
                .collect();
            (sender, events)
        };
        // A closed receiver means the index is shutting down.
        let _ = sender.send(events);
    }));
    if outcome.is_err() {
        std::process::abort();
    }
}
