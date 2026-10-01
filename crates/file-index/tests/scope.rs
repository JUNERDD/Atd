//! The first walk: which files the index keeps, and where it says they are.

mod common;

use std::fs;

use common::{Fixture, finds};

#[test]
fn keeps_attachable_files_and_applies_every_exclusion() {
    let fixture = Fixture::new();
    let kept = [
        fixture.write("notes.md", "home level"),
        fixture.write("Documents/plan.md", "nested"),
        // `Library` is only skipped directly inside home.
        fixture.write("proj/Library/inner.md", "deeper Library"),
        fixture.write("repo/keep.ts", "tracked"),
        // Outside a git repository `.gitignore` does not apply, as in git and ripgrep.
        fixture.write("loose/skipme.md", "not in a repo"),
    ];
    fs::write(fixture.home.join("loose/.gitignore"), "skipme.md\n").unwrap();
    let dropped = [
        fixture.write(".hidden.md", "hidden file"),
        fixture.write("Documents/.secret/hidden-dir.md", "hidden folder"),
        fixture.write("image.png.bak", "not attachable"),
        fixture.write("Library/system.md", "home Library"),
        fixture.write("proj/Library/Containers/box.md", "Raycast glob"),
        fixture.write("proj/node_modules/pkg/readme.md", "dependency tree"),
        fixture.write("proj/dist/bundle.js.md", "build output"),
        fixture.write("Tool.app/Contents/bundle.md", "app bundle"),
        fixture.write("repo/ignored/deep/ignored.md", "gitignored folder"),
        fixture.write("repo/secret.txt", "gitignored file"),
        fixture.write("quiet/never.md", "marker folder"),
        fixture.write("proj/DerivedData/derived.md", "Xcode output"),
    ];
    fs::create_dir_all(fixture.home.join("repo/.git")).unwrap();
    fs::write(
        fixture.home.join("repo/.gitignore"),
        "ignored/\nsecret.txt\n",
    )
    .unwrap();
    fs::write(fixture.home.join("quiet/.metadata_never_index"), "").unwrap();

    let index = fixture.ready();
    for path in &kept {
        let stem = path.file_stem().unwrap().to_str().unwrap();
        assert!(
            finds(&index, stem, path),
            "expected {} to be indexed",
            path.display()
        );
    }
    for path in &dropped {
        let stem = path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .split('.')
            .next()
            .unwrap();
        let stem = if stem.is_empty() { "hidden" } else { stem };
        assert!(
            !finds(&index, stem, path),
            "expected {} to be excluded",
            path.display()
        );
    }
    assert_eq!(index.status().scanned_files, kept.len() as u64);
}

#[test]
fn reports_locations_and_keeps_icloud_drive_apart_from_home() {
    let fixture = Fixture::new();
    let local = fixture.write("Projects/2026/cloud.md", "local");
    let icloud = fixture.write(
        "Library/Mobile Documents/com~apple~CloudDocs/Work/cloud.md",
        "icloud",
    );
    let top = fixture.write("cloud.md", "home level");
    let index = fixture.ready();

    let hits = index.query("cloud", 10).unwrap();
    let location = |path: &std::path::Path| {
        hits.iter()
            .find(|hit| hit.path == path)
            .map(|hit| hit.location.clone())
    };
    assert_eq!(location(&top).as_deref(), Some(""));
    assert_eq!(location(&local).as_deref(), Some("Projects/2026"));
    assert_eq!(location(&icloud).as_deref(), Some("iCloud Drive/Work"));
    // A folder name matches too: the iCloud label is part of the location.
    assert!(finds(&index, "icloud", &icloud));
    // Ids are stable per path and distinct across the three files.
    let again = index.query("cloud", 10).unwrap();
    assert_eq!(
        hits.iter().map(|hit| &hit.id).collect::<Vec<_>>(),
        again.iter().map(|hit| &hit.id).collect::<Vec<_>>()
    );
    let mut ids: Vec<_> = hits.iter().map(|hit| hit.id.clone()).collect();
    ids.dedup();
    assert_eq!(ids.len(), 3);
}

#[test]
fn ranks_like_the_typescript_search() {
    let fixture = Fixture::new();
    fixture.write("deep/er/still/budget.md", "exact, deep");
    fixture.write("budgets-2026.md", "prefix");
    fixture.write("team budget notes.txt", "word start");
    fixture.write("budget/readme.md", "folder only");
    fixture.write("report.md", "substring of the query `port`");
    fixture.write("port-notes.md", "word prefix of the query `port`");
    let index = fixture.ready();

    let hits = index.query("budget", 10).unwrap();
    assert_eq!(
        common::names(&hits),
        [
            "budget.md",
            "budgets-2026.md",
            "team budget notes.txt",
            "readme.md"
        ]
    );
    assert_eq!(hits[0].name_match, Some((0, 6)));
    assert_eq!(hits[2].name_match, Some((5, 11)));
    assert_eq!(hits[3].name_match, None);
    assert!(hits.windows(2).all(|pair| pair[0].score >= pair[1].score));
    assert_eq!(hits[0].size, Some("exact, deep".len() as u64));
    // Mid-word matches come from the in-memory name list (R10) and rank below word matches.
    let hits = index.query("port", 10).unwrap();
    assert_eq!(common::names(&hits), ["port-notes.md", "report.md"]);
    assert_eq!(hits[1].name_match, Some((2, 6)));
    // With enough word matches to fill the limit, the list is not consulted.
    assert_eq!(
        common::names(&index.query("port", 1).unwrap()),
        ["port-notes.md"]
    );
}

#[test]
fn an_empty_query_lists_recently_modified_files() {
    let fixture = Fixture::new();
    fixture.write("Documents/fresh.md", "new");
    let index = fixture.ready();
    assert_eq!(common::names(&index.query("", 10).unwrap()), ["fresh.md"]);
    assert_eq!(common::names(&index.query("f", 10).unwrap()), ["fresh.md"]);
}
