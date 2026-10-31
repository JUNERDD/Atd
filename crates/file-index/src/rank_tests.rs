use super::*;

const NOW: u64 = 1_800_000_000_000;

fn file(location: &str, name: &str, age_days: u64) -> Candidate {
    let path = if location.is_empty() {
        format!("/h/{name}")
    } else {
        format!("/h/{location}/{name}")
    };
    Candidate {
        path: PathBuf::from(path),
        name: name.into(),
        location: location.into(),
        modified_ms: Some(NOW - age_days * DAY_MS),
    }
}

fn names(ranked: &[Ranked]) -> Vec<String> {
    ranked
        .iter()
        .map(|entry| entry.candidate.name.clone())
        .collect()
}

#[test]
fn tiers_dominate_recency_and_placement() {
    let ranked = rank(
        "plan",
        vec![
            file("", "the plan.md", 0),       // word start, fresh
            file("docs/a/b", "plan.md", 400), // exact, old and deep
            file("", "planning.md", 400),     // prefix
            file("", "airplane.txt", 0),      // substring
            file("plans", "notes.md", 0),     // folder only
            file("", "unrelated.md", 0),      // dropped
        ],
        NOW,
    );
    assert_eq!(
        names(&ranked),
        [
            "plan.md",
            "planning.md",
            "the plan.md",
            "airplane.txt",
            "notes.md"
        ]
    );
    assert_eq!(ranked[0].matches, [(0, 4)]);
    assert_eq!(ranked[2].matches, [(4, 8)]);
    assert_eq!(ranked[3].matches, [(3, 7)]);
    assert!(ranked[4].matches.is_empty());
}

#[test]
fn recency_and_placement_reorder_within_a_tier() {
    let ranked = rank(
        "report",
        vec![
            file("", "report-old.md", 90),
            file("", "report-week.md", 5),
            file("", "report-today.md", 0),
            file("a/b/c", "report-deep.md", 0),
            file("proj/logs", "report-noisy.md", 0),
        ],
        NOW,
    );
    // Prefix 4000 plus recency (300 / 200 / 0), minus 20 per folder and 500 under `logs`:
    // today 4300, deep 4240, week 4200, old 4000, noisy 3760.
    assert_eq!(
        names(&ranked),
        [
            "report-today.md",
            "report-deep.md",
            "report-week.md",
            "report-old.md",
            "report-noisy.md"
        ]
    );
    assert_eq!(ranked[0].score, 4300);
    assert_eq!(ranked[4].score, 4300 - 2 * DEPTH_PENALTY - NOISY_PENALTY);
}

#[test]
fn ties_prefer_shorter_names_then_paths() {
    let ranked = rank(
        "a",
        vec![
            file("y", "a-long.md", 0),
            file("x", "a-long.md", 0),
            file("z", "a.md", 0),
        ],
        NOW,
    );
    assert_eq!(ranked[0].candidate.name, "a.md");
    assert_eq!(ranked[1].candidate.path, PathBuf::from("/h/x/a-long.md"));
}

#[test]
fn an_empty_query_lists_newest_first_without_matches() {
    let ranked = rank(
        "  ",
        vec![file("", "old.md", 3), file("", "new.md", 0)],
        NOW,
    );
    assert_eq!(names(&ranked), ["new.md", "old.md"]);
    assert!(
        ranked
            .iter()
            .all(|entry| entry.score == 0 && entry.matches.is_empty())
    );
}

#[test]
fn matching_ignores_case_accents_and_normalization_form() {
    let ranked = rank(
        "resume",
        vec![file("", "Re\u{301}sume\u{301} 2026.md", 0)],
        NOW,
    );
    assert_eq!(ranked.len(), 1);
    // Prefix of the NFC name "Résumé 2026.md": six UTF-16 units.
    assert_eq!(ranked[0].matches, [(0, 6)]);
    assert_eq!(rank("CAFÉ", vec![file("", "cafe.md", 0)], NOW).len(), 1);
    assert!(rank("tea", vec![file("", "cafe.md", 0)], NOW).is_empty());
    // Mid-word, folded on both sides.
    let ranked = rank("afé", vec![file("", "Cafe\u{301}-menu.md", 0)], NOW);
    assert_eq!(ranked[0].matches, [(1, 4)]);
}

#[test]
fn a_stem_equal_to_the_query_is_exact() {
    let ranked = rank(
        "notes",
        vec![file("", "notes-2.md", 0), file("", "Notes.MD", 0)],
        NOW,
    );
    assert_eq!(names(&ranked), ["Notes.MD", "notes-2.md"]);
    assert_eq!(ranked[0].score, 5300);
}

#[test]
fn separators_are_interchangeable() {
    let ranked = rank(
        "budget_2024",
        vec![
            file("", "budget2024.csv", 0),     // fuzzy
            file("", "my budget 2024.pdf", 0), // word start
            file("", "budget - 2024.xlsx", 0), // prefix
            file("", "notes.md", 0),           // dropped
        ],
        NOW,
    );
    assert_eq!(
        names(&ranked),
        ["budget - 2024.xlsx", "my budget 2024.pdf", "budget2024.csv"]
    );
    assert_eq!(ranked[0].matches, [(0, 13)]);
}

#[test]
fn fuzzy_matches_rank_below_contiguous_name_and_folder_matches() {
    let ranked = rank(
        "mnrs",
        vec![
            file("", "main.rs", 0),
            file("", "mnrs-notes.md", 0),
            file("mnrs", "readme.md", 0),
        ],
        NOW,
    );
    assert_eq!(names(&ranked), ["mnrs-notes.md", "readme.md", "main.rs"]);
    assert!(ranked[1].matches.is_empty());
    assert_eq!(ranked[2].matches, [(0, 1), (3, 4), (5, 7)]);
    assert!(ranked[2].score > Tier::Fuzzy.score() && ranked[2].score < Tier::Folder.score());
}

#[test]
fn folders_before_a_slash_match_the_end_of_the_location() {
    let ranked = rank(
        "src/main",
        vec![
            file("proj/src/lib", "main.rs", 0), // one folder passed over
            file("proj/test", "main.rs", 0),    // no `src` folder
            file("proj/src", "readme.md", 0),   // the name misses
            file("proj/src", "main.rs", 0),
        ],
        NOW,
    );
    let paths: Vec<_> = ranked
        .iter()
        .map(|entry| entry.candidate.path.clone())
        .collect();
    assert_eq!(
        paths,
        [
            PathBuf::from("/h/proj/src/main.rs"),
            PathBuf::from("/h/proj/src/lib/main.rs")
        ]
    );
    assert_eq!(ranked[0].matches, [(0, 4)]);
}

#[test]
fn a_single_ideograph_is_a_full_query() {
    let ranked = rank(
        "表",
        vec![
            file("", "月度报表.xlsx", 400),
            file("", "表格.numbers", 400),
        ],
        NOW,
    );
    assert_eq!(names(&ranked), ["表格.numbers", "月度报表.xlsx"]);
    assert_eq!(ranked[1].matches, [(3, 4)]);
    assert!(!crate::pattern::Pattern::parse("表", &[]).recent);
}
