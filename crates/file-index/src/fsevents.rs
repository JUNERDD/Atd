//! FSEvents through `fsevent-sys`, chosen over `notify` because resuming needs event ids:
//! notify 8.2.0 always starts its stream at `kFSEventStreamEventIdSinceNow` and drops the ids
//! its callback receives, so a restart could not replay what happened while the app was closed.

use std::ffi::{CStr, CString, c_char, c_void};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::thread::JoinHandle;

use fsevent_sys as fs;
use fsevent_sys::core_foundation as cf;

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

// Declarations fsevent-sys 4.1.0 leaves out.
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRunLoopRunInMode(mode: cf::CFStringRef, seconds: f64, return_after_source: u8) -> i32;
    fn CFUUIDCreateString(allocator: cf::CFAllocatorRef, uuid: cf::CFRef) -> cf::CFStringRef;
}
#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn FSEventsCopyUUIDForDevice(device: libc::dev_t) -> cf::CFRef;
}

/// Seconds FSEvents waits to coalesce changes before delivering them.
const LATENCY_SECONDS: f64 = 0.5;
/// How often the run loop thread checks for a stop request.
const POLL_SECONDS: f64 = 0.2;

/// The id of the newest event recorded on this Mac.
pub(crate) fn current_event_id() -> u64 {
    // SAFETY: a plain query without arguments.
    unsafe { fs::FSEventsGetCurrentEventId() }
}

/// The FSEvents database UUID of the volume holding `path`; `None` when the volume keeps no
/// event history (then no id from it can be replayed).
pub(crate) fn volume_uuid(path: &Path) -> Option<String> {
    let device = std::fs::metadata(path).ok()?.dev() as libc::dev_t;
    // SAFETY: both CF objects are created here, checked for null and released exactly once;
    // the buffer outlives the call that fills it.
    unsafe {
        let uuid = FSEventsCopyUUIDForDevice(device);
        if uuid.is_null() {
            return None;
        }
        let text = CFUUIDCreateString(cf::kCFAllocatorDefault, uuid);
        cf::CFRelease(uuid);
        if text.is_null() {
            return None;
        }
        let mut buffer = [0 as c_char; 64];
        let ok = cf::CFStringGetCString(text, buffer.as_mut_ptr(), 64, cf::kCFStringEncodingUTF8);
        cf::CFRelease(text);
        ok.then(|| {
            CStr::from_ptr(buffer.as_ptr())
                .to_string_lossy()
                .into_owned()
        })
    }
}

/// A running event stream over some folders. Batches go to the sender on a dedicated thread
/// that owns the stream and its run loop; dropping the value stops and joins that thread.
#[derive(Debug)]
pub(crate) struct EventStream {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl EventStream {
    /// Starts delivering events after `since` (`None`: from now on).
    pub fn start(
        paths: &[PathBuf],
        since: Option<u64>,
        sender: Sender<Vec<RawEvent>>,
    ) -> Result<Self, Error> {
        let paths: Vec<CString> = paths
            .iter()
            .map(|path| CString::new(path.as_os_str().as_bytes()))
            .collect::<Result<_, _>>()
            .map_err(|error| Error::Watch(error.to_string()))?;
        let since = since.unwrap_or(fs::kFSEventStreamEventIdSinceNow);
        let stop = Arc::new(AtomicBool::new(false));
        let (ready, started) = mpsc::channel();
        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("file-index-events".into())
            .spawn(move || run(&paths, since, sender, &thread_stop, &ready))
            .map_err(|error| Error::Watch(error.to_string()))?;
        match started.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(Error::Watch(message))
            }
            Err(_) => Err(Error::Watch(
                "the event thread ended before starting".into(),
            )),
        }
    }
}

impl Drop for EventStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The run loop thread: creates, runs and tears down the stream. The sender is boxed as the
/// stream's callback context and freed only after the stream is released, when no callback can
/// run any more.
fn run(
    paths: &[CString],
    since: u64,
    sender: Sender<Vec<RawEvent>>,
    stop: &AtomicBool,
    ready: &Sender<Result<(), String>>,
) {
    let info = Box::into_raw(Box::new(sender));
    let context = fs::FSEventStreamContext {
        version: 0,
        info: info.cast::<c_void>(),
        retain: None,
        release: None,
        copy_description: None,
    };
    let create_flags =
        fs::kFSEventStreamCreateFlagFileEvents | fs::kFSEventStreamCreateFlagWatchRoot;
    // SAFETY: the array and strings are created and released here; the stream copies the path
    // array. The stream is scheduled on this thread's run loop, stopped, invalidated and released
    // on this thread, and `info` is freed after that, so the callback never sees a dangling
    // pointer.
    unsafe {
        let array =
            cf::CFArrayCreateMutable(cf::kCFAllocatorDefault, 0, &cf::kCFTypeArrayCallBacks);
        for path in paths {
            let text = cf::CFStringCreateWithCString(
                cf::kCFAllocatorDefault,
                path.as_ptr(),
                cf::kCFStringEncodingUTF8,
            );
            cf::CFArrayAppendValue(array, text);
            cf::CFRelease(text);
        }
        let stream = fs::FSEventStreamCreate(
            cf::kCFAllocatorDefault,
            callback,
            &context,
            array,
            since,
            LATENCY_SECONDS,
            create_flags,
        );
        cf::CFRelease(array);
        if stream.is_null() {
            drop(Box::from_raw(info));
            let _ = ready.send(Err("FSEventStreamCreate failed".into()));
            return;
        }
        fs::FSEventStreamScheduleWithRunLoop(
            stream,
            cf::CFRunLoopGetCurrent(),
            cf::kCFRunLoopDefaultMode,
        );
        if fs::FSEventStreamStart(stream) == 0 {
            fs::FSEventStreamInvalidate(stream);
            fs::FSEventStreamRelease(stream);
            drop(Box::from_raw(info));
            let _ = ready.send(Err("FSEventStreamStart failed".into()));
            return;
        }
        let _ = ready.send(Ok(()));
        while !stop.load(Ordering::Relaxed) {
            CFRunLoopRunInMode(cf::kCFRunLoopDefaultMode, POLL_SECONDS, 0);
        }
        fs::FSEventStreamStop(stream);
        fs::FSEventStreamInvalidate(stream);
        fs::FSEventStreamRelease(stream);
        drop(Box::from_raw(info));
    }
}

extern "C" fn callback(
    _stream: fs::FSEventStreamRef,
    info: *mut c_void,
    count: usize,
    paths: *mut c_void,
    event_flags: *const fs::FSEventStreamEventFlags,
    event_ids: *const fs::FSEventStreamEventId,
) {
    // SAFETY: FSEvents passes `count` C strings (no `UseCFTypes` flag), flags and ids, valid for
    // the duration of the call; `info` is the boxed sender, alive until the stream is released.
    let (sender, events) = unsafe {
        let sender = &*info.cast::<Sender<Vec<RawEvent>>>();
        let paths = std::slice::from_raw_parts(paths.cast::<*const c_char>(), count);
        let event_flags = std::slice::from_raw_parts(event_flags, count);
        let event_ids = std::slice::from_raw_parts(event_ids, count);
        let events: Vec<RawEvent> = (0..count)
            .map(|index| RawEvent {
                path: PathBuf::from(std::ffi::OsString::from_vec(
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
}
