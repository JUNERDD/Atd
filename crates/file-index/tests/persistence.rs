//! The saved store and resume point: reopening answers without a walk, and a restart replays
//! the FSEvents history recorded while the index was closed.

mod common;

use std::fs;

use common::{Fixture, finds, wait_for};
use file_index::{FileIndex, Phase};

#[test]
fn reopening_answers_from_the_saved_store_before_start() {
    let fixture = Fixture::new();
    let kept = fixture.write("Documents/ledger.md", "saved");
    let index = fixture.ready();
    let saved_id = index.status().last_event_id;
    assert_ne!(saved_id, 0);
    index.close().unwrap();
    drop(index);

    let reopened = fixture.open();
    let status = reopened.status();
    assert_eq!(status.phase, Phase::Idle);
    assert_eq!(status.last_event_id, saved_id);
    assert!(
        finds(&reopened, "ledger", &kept),
        "the store should survive a restart"
    );
    reopened.start().unwrap();
    let status = reopened.status();
    assert!(
        status.resumed,
        "a complete store with a saved event id resumes"
    );
    assert_eq!(status.phase, Phase::Watching);
    assert_eq!(status.scanned_files, 0, "resuming must not walk home again");
}

#[test]
fn a_restart_replays_changes_made_while_closed() {
    let fixture = Fixture::new();
    let removed = fixture.write("drafts/obsolete.md", "gone soon");
    let renamed_from = fixture.write("drafts/before.md", "renamed soon");
    let index = fixture.ready();
    index.close().unwrap();
    drop(index);

    // Changes while no process watches.
    let added = fixture.write("drafts/offline-added.md", "new");
    fs::remove_file(&removed).unwrap();
    let renamed_to = fixture.home.join("drafts/after.md");
    fs::rename(&renamed_from, &renamed_to).unwrap();
    let moved_folder = fixture.write("inbox/sub/moved.md", "folder moves");
    fs::rename(fixture.home.join("inbox"), fixture.home.join("archive")).unwrap();
    let moved_to = fixture.home.join("archive/sub/moved.md");

    let index = fixture.open();
    index.start().unwrap();
    assert!(index.status().resumed);
    wait_for(|| finds(&index, "offline", &added), "the offline file");
    wait_for(|| finds(&index, "after", &renamed_to), "the rename target");
    wait_for(
        || finds(&index, "moved", &moved_to),
        "the moved folder's file",
    );
    assert!(!finds(&index, "obsolete", &removed));
    assert!(!finds(&index, "before", &renamed_from));
    assert!(!finds(&index, "moved", &moved_folder));
    assert_eq!(
        index.status().scanned_files,
        3,
        "only the changed paths are walked"
    );
}

#[test]
fn a_different_extension_list_or_a_damaged_state_rebuilds() {
    let fixture = Fixture::new();
    let text = fixture.write("a/plain.txt", "text");
    let index = fixture.ready();
    index.close().unwrap();
    drop(index);

    // The caller's attachment rules dropped `txt`: the store is discarded and rebuilt.
    let narrower = FileIndex::open(&fixture.data, fixture.options_with(&["md"])).unwrap();
    assert!(!finds(&narrower, "plain", &text));
    narrower.start().unwrap();
    assert!(!narrower.status().resumed);
    wait_for(|| narrower.status().phase == Phase::Watching, "the rebuild");
    narrower.close().unwrap();
    drop(narrower);

    fs::write(fixture.data.join("state.json"), b"{ damaged").unwrap();
    let index = fixture.open();
    index.start().unwrap();
    assert!(!index.status().resumed);
    wait_for(|| finds(&index, "plain", &text), "the rebuilt entry");
}

#[test]
fn an_interrupted_first_walk_still_ends_complete() {
    let fixture = Fixture::new();
    for index in 0..300 {
        fixture.write(&format!("bulk/{index:03}/file-{index}.md"), "bulk");
    }
    let index = fixture.open();
    index.start().unwrap();
    // Close at once: a walk cut short leaves the state incomplete, so the reopened index walks
    // again instead of resuming a partial store.
    index.close().unwrap();
    drop(index);

    let reopened = fixture.open();
    reopened.start().unwrap();
    wait_for(|| reopened.status().phase == Phase::Watching, "the walk");
    assert_eq!(reopened.query("file", 100).unwrap().len(), 100);
    let bulk = reopened.query("bulk", 100).unwrap();
    assert_eq!(bulk.len(), 100, "every file matches the `bulk` folder word");
}
