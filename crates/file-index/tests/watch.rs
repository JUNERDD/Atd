//! Live updates while the index runs.

mod common;

use std::fs;

use common::{Fixture, finds, wait_for};

#[test]
fn follows_creates_renames_and_removals() {
    let fixture = Fixture::new();
    let existing = fixture.write("work/existing.md", "old");
    let index = fixture.ready();

    let created = fixture.write("work/fresh-idea.md", "new");
    wait_for(|| finds(&index, "fresh", &created), "a created file");

    let renamed = fixture.home.join("work/renamed-idea.md");
    fs::rename(&created, &renamed).unwrap();
    wait_for(|| finds(&index, "renamed", &renamed), "a rename target");
    wait_for(
        || !finds(&index, "fresh", &created),
        "a rename source to disappear",
    );

    let nested = fixture.write("work/project/src/module.ts", "code");
    wait_for(|| finds(&index, "module", &nested), "a file in new folders");
    fs::rename(
        fixture.home.join("work/project"),
        fixture.home.join("work/moved"),
    )
    .unwrap();
    let moved = fixture.home.join("work/moved/src/module.ts");
    wait_for(
        || finds(&index, "module", &moved),
        "a file in a moved folder",
    );
    assert!(!finds(&index, "module", &nested));

    fs::remove_file(&existing).unwrap();
    wait_for(|| !finds(&index, "existing", &existing), "a removed file");
    fs::remove_dir_all(fixture.home.join("work/moved")).unwrap();
    wait_for(
        || !finds(&index, "module", &moved),
        "a removed folder's files",
    );
    assert!(index.status().error.is_none());
}

#[test]
fn live_changes_respect_the_same_exclusions_as_the_walk() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.home.join("repo/.git")).unwrap();
    fs::write(fixture.home.join("repo/.gitignore"), "build-out/\n").unwrap();
    let index = fixture.ready();

    // Excluded by gitignore on an ancestor, by name, by extension, and hidden.
    let ignored = fixture.write("repo/build-out/nested/deep/ignored.md", "x");
    let dependency = fixture.write("repo/node_modules/pkg/dependency.md", "x");
    let binary = fixture.write("repo/picture.png", "x");
    let hidden = fixture.write("repo/.cache/hidden.md", "x");
    // FSEvents delivers in order, so once the sentinel shows up the others were processed.
    let sentinel = fixture.write("repo/sentinel.md", "x");
    wait_for(|| finds(&index, "sentinel", &sentinel), "the sentinel");
    assert!(!finds(&index, "ignored", &ignored));
    assert!(!finds(&index, "dependency", &dependency));
    assert!(!finds(&index, "picture", &binary));
    assert!(!finds(&index, "hidden", &hidden));

    // A marker added later takes the folder out on its next change.
    let quiet = fixture.write("quiet/private.md", "x");
    wait_for(
        || finds(&index, "private", &quiet),
        "a file before its folder is marked",
    );
    fs::write(fixture.home.join("quiet/.metadata_never_index"), "").unwrap();
    fs::rename(fixture.home.join("quiet"), fixture.home.join("hushed")).unwrap();
    let hushed = fixture.home.join("hushed/private.md");
    let sentinel = fixture.write("second-sentinel.md", "x");
    wait_for(|| finds(&index, "second", &sentinel), "the second sentinel");
    assert!(!finds(&index, "private", &hushed));
    assert!(!finds(&index, "private", &quiet));
}
