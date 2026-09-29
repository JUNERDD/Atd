//! Case- and accent-insensitive matching, ported from `rank.ts` (`foldText`, `foldName`,
//! `nameRange`). Folding is per character: NFD, drop combining marks, lower-case. Ranges are
//! UTF-16 offsets into the NFC name, the text and unit the renderer highlights.

use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// `[from, to)` UTF-16 offsets into the NFC name.
pub type NameRange = (u32, u32);

/// The query or a folder text, folded.
pub(crate) fn fold_text(value: &str) -> Vec<char> {
    if value.is_ascii() {
        return value
            .chars()
            .map(|char| char.to_ascii_lowercase())
            .collect();
    }
    value.chars().flat_map(fold_char).collect()
}

fn fold_char(char: char) -> impl Iterator<Item = char> {
    std::iter::once(char)
        .nfd()
        .filter(|char| !is_combining_mark(*char))
        .flat_map(char::to_lowercase)
}

/// A file name folded for matching.
#[derive(Debug)]
pub(crate) struct FoldedName {
    /// UTF-16 length of the NFC name.
    text_len: u32,
    pub folded: Vec<char>,
    /// Where words start in `folded`.
    pub starts: Vec<usize>,
    /// For each char of `folded`, the UTF-16 offset in the NFC name of the char it came from.
    /// `None` for ASCII names, which fold char for char.
    origins: Option<Vec<u32>>,
}

/// Words start after separators (anything but letters, digits and marks) and at camelCase humps.
pub(crate) fn fold_name(name: &str) -> FoldedName {
    let mut starts = Vec::new();
    if name.is_ascii() {
        let mut previous: Option<char> = None;
        for (index, char) in name.chars().enumerate() {
            let hump =
                previous.is_some_and(|p| p.is_ascii_lowercase()) && char.is_ascii_uppercase();
            let word = char.is_ascii_alphanumeric();
            if word && (!previous.is_some_and(|p| p.is_ascii_alphanumeric()) || hump) {
                starts.push(index);
            }
            previous = Some(char);
        }
        let folded = name.chars().map(|char| char.to_ascii_lowercase()).collect();
        return FoldedName {
            text_len: name.len() as u32,
            folded,
            starts,
            origins: None,
        };
    }
    let is_word = |char: char| char.is_alphanumeric() || is_combining_mark(char);
    let mut folded = Vec::new();
    let mut origins = Vec::new();
    let mut previous: Option<char> = None;
    let mut offset = 0u32;
    for char in name.nfc() {
        let piece: Vec<char> = fold_char(char).collect();
        let hump = previous.is_some_and(char::is_lowercase) && char.is_uppercase();
        if !piece.is_empty() && is_word(char) && (!previous.is_some_and(is_word) || hump) {
            starts.push(folded.len());
        }
        // A char can fold to several chars (a Hangul syllable to its jamo) or to none (a mark).
        origins.extend(std::iter::repeat_n(offset, piece.len()));
        folded.extend(piece);
        offset += char.len_utf16() as u32;
        previous = Some(char);
    }
    FoldedName {
        text_len: offset,
        folded,
        starts,
        origins: Some(origins),
    }
}

impl FoldedName {
    /// Folded chars `[from, to)` as a range of the NFC name: the chars they came from plus the
    /// combining marks after the last one, so a highlight never splits a char from its marks.
    pub fn range(&self, from: usize, to: usize) -> NameRange {
        let Some(origins) = &self.origins else {
            return (from as u32, to as u32);
        };
        let matched = &origins[from..to];
        // Origins never decrease, so the extremes are the first and last matched chars.
        let (first, last) = (matched[0], matched[matched.len() - 1]);
        let next = origins[to..].iter().copied().find(|origin| *origin > last);
        (first, next.unwrap_or(self.text_len))
    }
}

pub(crate) fn starts_with_at(haystack: &[char], needle: &[char], at: usize) -> bool {
    haystack.get(at..at + needle.len()) == Some(needle)
}

pub(crate) fn find(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|at| starts_with_at(haystack, needle, *at))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(chars: &[char]) -> String {
        chars.iter().collect()
    }

    #[test]
    fn folds_case_and_accents() {
        assert_eq!(text(&fold_text("Résumé")), "resume");
        assert_eq!(text(&fold_text("README")), "readme");
    }

    #[test]
    fn finds_word_starts_at_separators_and_humps() {
        let name = fold_name("myFile-name_v2.md");
        assert_eq!(name.starts, [0, 2, 7, 12, 15]);
        let name = fold_name("Ångström Notes.md");
        assert_eq!(text(&name.folded), "angstrom notes.md");
        assert_eq!(name.starts, [0, 9, 15]);
    }

    #[test]
    fn maps_decomposed_names_to_nfc_offsets() {
        // "Cafe\u{301}" is stored decomposed on macOS; the renderer shows the NFC "Café".
        let name = fold_name("Cafe\u{301} menu.md");
        assert_eq!(text(&name.folded), "cafe menu.md");
        assert_eq!(name.range(0, 4), (0, 4));
        assert_eq!(name.range(5, 9), (5, 9));
        // NFC "é\u{302}x.md": the uncomposable circumflex stays with the highlighted "é".
        let marked = fold_name("e\u{301}\u{302}x.md");
        assert_eq!(marked.range(0, 1), (0, 2));
    }
}
