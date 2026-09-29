//! What the index leaves out, merged from two sources:
//!
//! - `apps/desktop/electron/file-search/scope.ts`: hidden entries, `.app` bundles, the directory
//!   names below, and the OS-owned `Library` folder directly in home. These carry over unchanged,
//!   so the index covers the same files the current search offers.
//! - Raycast 2.0's file indexer: the override globs below, read from the strings of
//!   `/Applications/Raycast.app/.../backend/indexer.darwin-arm64.node` (Raycast bundle dated
//!   2025-09-25 on the author's machine). Most of them sit under hidden folders or home's
//!   `Library`, which scope.ts already skips; they are kept verbatim so a nested `Library` folder
//!   (which scope.ts keeps searchable below home level) and future scope changes behave like
//!   Raycast. Raycast also honors `.metadata_never_index` marker files, as Spotlight does.
//!
//! Raycast's binary lists further bare names (`Caches`, `Application Support`, `vendor`, `tmp`,
//! ...) without context showing whether they are exclusions or classification hints, so they are
//! not adopted; ranking already demotes cache and output folders (see `rank::NOISY_FOLDERS`).

/// Directory names skipped at any depth, compared in lower case (scope.ts `EXCLUDED_DIRECTORIES`).
pub(crate) const EXCLUDED_DIRECTORIES: &[&str] = &[
    "node_modules",
    "bower_components",
    "__pycache__",
    "site-packages",
    "deriveddata",
    "dist",
    "build",
    "out",
    "target",
    "coverage",
];

/// The home-level folder holding OS and application data (scope.ts `SYSTEM_FOLDERS.darwin`).
pub(crate) const HOME_SYSTEM_FOLDER: &str = "library";

/// A directory containing this file is skipped with everything below it, as Spotlight does.
pub(crate) const NEVER_INDEX_MARKER: &str = ".metadata_never_index";

/// Raycast's exclusion globs, in `ignore` override syntax (`!` excludes).
pub(crate) const RAYCAST_GLOBS: &[&str] = &[
    "!**/Library/CloudStorage/**/.Encrypted",
    "!**/Library/CloudStorage/**/.Encrypted/**",
    "!**/Library/CloudStorage/**/.shortcut-targets-by-id",
    "!**/Library/CloudStorage/**/.shortcut-targets-by-id/**",
    "!**/Library/CloudStorage/**/.file-revisions-by-id",
    "!**/Library/CloudStorage/**/.file-revisions-by-id/**",
    "!**/Library/CloudStorage/**/.tmp",
    "!**/Library/CloudStorage/**/.tmp/**",
    "!**/Library/CloudStorage/**/.tmp.drive*",
    "!**/Library/CloudStorage/**/.tmp.drive*/**",
    "!**/Library/Containers/**",
    "!**/Library/Group Containers/**",
    "!**/Library/Application Scripts/**",
    "!**/DerivedData",
    "!**/DerivedData/**",
    "!**/.git/**",
    "!**/.jj",
    "!**/.jj/**",
    "!**/.hg",
    "!**/.hg/**",
    "!**/.svn/**",
    "!**/.bzr/**",
    "!**/.sl",
    "!**/.sl/**",
    "!**/.cargo/git",
    "!**/.cargo/git/**",
    "!**/.cargo/registry",
    "!**/.cargo/registry/**",
    "!**/.claude.json*",
    "!**/.claude/.*",
    "!**/.claude/.*/**",
    "!**/.claude/backups",
    "!**/.claude/backups/**",
    "!**/.claude/cache",
    "!**/.claude/cache/**",
    "!**/.claude/debug",
    "!**/.claude/debug/**",
    "!**/.claude/downloads",
    "!**/.claude/downloads/**",
    "!**/.claude/history.jsonl",
    "!**/.claude/ide",
    "!**/.claude/ide/**",
    "!**/.claude/paste-cache",
    "!**/.claude/paste-cache/**",
    "!**/.claude/plugins",
    "!**/.claude/plugins/**",
    "!**/.claude/projects",
    "!**/.claude/projects/**",
    "!**/.claude/session-env",
    "!**/.claude/session-env/**",
    "!**/.claude/sessions",
    "!**/.claude/sessions/**",
    "!**/.claude/shell-snapshots",
    "!**/.claude/shell-snapshots/**",
    "!**/.claude/tasks",
    "!**/.claude/tasks/**",
    "!**/.claude/telemetry",
    "!**/.claude/telemetry/**",
    "!**/.codex",
    "!**/.codex/**",
    "!**/.npm/**",
    "!**/.swiftpm/cache",
    "!**/.swiftpm/cache/**",
    "!**/.swiftpm/security",
    "!**/.swiftpm/security/**",
    "!*.temp",
    "!*.tmp",
    "!node_modules",
];

/// Whether a directory name is skipped by the scope.ts rules. `home_level` marks a folder directly
/// inside the home root, where the OS-owned `Library` folder is skipped.
pub(crate) fn is_excluded_directory(name: &str, home_level: bool) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || lower.ends_with(".app")
        || EXCLUDED_DIRECTORIES.contains(&lower.as_str())
        || (home_level && lower == HOME_SYSTEM_FOLDER)
}

/// Hidden files are never offered (scope.ts `locate`).
pub(crate) fn is_excluded_file(name: &str) -> bool {
    name.starts_with('.')
}
