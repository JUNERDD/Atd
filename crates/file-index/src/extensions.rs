use std::collections::BTreeSet;
use std::path::Path;

use crate::Error;

/// The attachable file extensions the index keeps, lower case and without the dot.
///
/// The list has one owner: `ATTACHABLE_EXTENSIONS` in the TypeScript attachment rules
/// (`packages/agent-contracts/src/attachments.ts`). The service passes that list to
/// `FileIndex::open`, so Rust never holds a second copy that could drift. The list is saved with
/// the index state; opening with a different list discards the index and rescans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extensions(BTreeSet<String>);

impl Extensions {
    /// Validates the list: at least one entry, each ASCII alphanumeric. Case is folded.
    pub fn new<I, S>(extensions: I) -> Result<Self, Error>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut set = BTreeSet::new();
        for extension in extensions {
            let extension = extension.as_ref();
            let valid = !extension.is_empty()
                && extension.len() <= 16
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric());
            if !valid {
                return Err(Error::InvalidOptions(format!(
                    "invalid extension {extension:?}: expected 1-16 ASCII letters or digits"
                )));
            }
            set.insert(extension.to_ascii_lowercase());
        }
        if set.is_empty() {
            return Err(Error::InvalidOptions("no extensions given".into()));
        }
        Ok(Self(set))
    }

    /// Whether a file name's last extension is in the list, the rule `attachableExtension` applies:
    /// a leading dot alone (`.env`) is not an extension.
    pub fn matches_name(&self, name: &str) -> bool {
        match name.rfind('.') {
            Some(dot) if dot > 0 => {
                let extension = &name[dot + 1..];
                extension.len() <= 16 && self.0.contains(&extension.to_ascii_lowercase())
            }
            _ => false,
        }
    }

    pub fn matches_path(&self, path: &Path) -> bool {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| self.matches_name(name))
    }

    /// Sorted list, as saved in the index state.
    pub fn to_vec(&self) -> Vec<String> {
        self.0.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_last_extension_case_insensitively() {
        let extensions = Extensions::new(["md", "TS"]).unwrap();
        assert!(extensions.matches_name("notes.MD"));
        assert!(extensions.matches_name("archive.tar.ts"));
        assert!(!extensions.matches_name("notes.md.bak"));
        assert!(!extensions.matches_name(".md"));
        assert!(!extensions.matches_name("md"));
        assert_eq!(extensions.to_vec(), ["md", "ts"]);
    }

    #[test]
    fn rejects_malformed_lists() {
        assert!(Extensions::new(Vec::<String>::new()).is_err());
        assert!(Extensions::new([".md"]).is_err());
        assert!(Extensions::new(["m d"]).is_err());
    }
}
