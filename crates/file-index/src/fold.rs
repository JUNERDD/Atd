//! Case-, accent- and width-insensitive matching. Names and queries fold the same way, per char:
//! compatibility decomposition (full-width forms, ligatures), combining marks dropped except the
//! kana voicing marks (`は` and `ば` are different letters), lower case. Runs of separators
//! (white space, `_`, `-`, `.`) compare as one space, so the four are interchangeable. Ranges
//! are UTF-16 offsets into the NFC name, the text and unit the renderer highlights.

use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// `[from, to)` UTF-16 offsets into the NFC name.
pub type NameRange = (u32, u32);

/// Whether a char separates words in names and queries.
pub(crate) fn is_separator(char: char) -> bool {
    char.is_whitespace() || matches!(char, '_' | '-' | '.')
}

/// Letters, digits and the marks kept on them; anything else ends a word.
fn is_word(char: char) -> bool {
    char.is_alphanumeric() || is_combining_mark(char)
}

/// One char folded for accents and width, case kept.
fn fold_char(char: char) -> impl Iterator<Item = char> {
    std::iter::once(char)
        .nfkd()
        .filter(|char| !is_combining_mark(*char) || matches!(char, '\u{3099}' | '\u{309A}'))
}

/// A query segment folded like names: lower case, each run of separators one space, none at the
/// ends.
pub(crate) fn fold_query(text: &str) -> Vec<char> {
    let mut folded = Vec::with_capacity(text.len());
    let mut gap = false;
    for char in text
        .chars()
        .flat_map(fold_char)
        .flat_map(char::to_lowercase)
    {
        if is_separator(char) {
            gap = !folded.is_empty();
        } else {
            if std::mem::take(&mut gap) {
                folded.push(' ');
            }
            folded.push(char);
        }
    }
    folded
}

/// Which chars a lower-case folded text holds, one bit per letter or digit and hashed bits for
/// the rest: a text can only match a query whose bits it all has. Separators carry no bit.
pub(crate) fn mask(chars: impl IntoIterator<Item = char>) -> u64 {
    chars.into_iter().fold(0, |mask, char| {
        mask | match char {
            'a'..='z' => 1 << (char as u32 - 'a' as u32),
            '0'..='9' => 1 << (26 + char as u32 - '0' as u32),
            _ if is_separator(char) => 0,
            _ => 1 << (36 + char as u32 % 28),
        }
    })
}

/// A non-ASCII name with accents and width folded, case kept, made once when the name is stored
/// so that queries never fold names again. ASCII names need no folding and keep none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FoldedName {
    /// What fuzzy matching scores.
    pub text: Box<str>,
    /// For each char of `text`, the UTF-16 offset in the NFC name of the char it came from. File
    /// names hold at most 255 UTF-16 units, so offsets fit.
    origins: Box<[u16]>,
    /// UTF-16 length of the NFC name.
    pub len: u16,
}

impl FoldedName {
    pub fn new(name: &str) -> Self {
        let (mut text, mut origins, mut offset) = (String::new(), Vec::new(), 0u16);
        for char in name.nfc() {
            for folded in fold_char(char) {
                text.push(folded);
                origins.push(offset);
            }
            offset = offset.saturating_add(char.len_utf16() as u16);
        }
        Self {
            text: text.into_boxed_str(),
            origins: origins.into_boxed_slice(),
            len: offset,
        }
    }

    fn chars(&self) -> impl Iterator<Item = (char, u32)> + '_ {
        let origins = self.origins.iter().map(|origin| u32::from(*origin));
        self.text.chars().zip(origins)
    }
}

/// UTF-16 length of a stored name in NFC.
pub(crate) fn nfc_len(name: &str, folded: Option<&FoldedName>) -> u32 {
    folded.map_or(name.len() as u32, |folded| u32::from(folded.len))
}

/// The text fuzzy matching scores for a stored name: the name itself when ASCII.
pub(crate) fn fuzzy_text<'a>(name: &'a str, folded: Option<&'a FoldedName>) -> &'a str {
    folded.map_or(name, |folded| &folded.text)
}

/// Byte offsets of matched chars in `fuzzy_text`, ascending, as merged NFC ranges. An ASCII
/// name has no folded form, and its byte offsets are its UTF-16 offsets.
pub(crate) fn byte_ranges(folded: Option<&FoldedName>, bytes: &[u32]) -> Vec<NameRange> {
    let mut ranges: Vec<NameRange> = Vec::new();
    let mut push = |from: u32, to: u32| match ranges.last_mut() {
        Some(last) if from <= last.1 => last.1 = last.1.max(to),
        _ => ranges.push((from, to)),
    };
    let Some(folded) = folded else {
        bytes.iter().for_each(|byte| push(*byte, byte + 1));
        return ranges;
    };
    let starts: Vec<u32> = folded
        .text
        .char_indices()
        .map(|(at, _)| at as u32)
        .collect();
    for byte in bytes {
        let index = starts.partition_point(|start| start <= byte) - 1;
        let from = u32::from(folded.origins[index]);
        let after = folded.origins[index + 1..]
            .iter()
            .find(|origin| u32::from(**origin) > from);
        push(
            from,
            after.map_or(u32::from(folded.len), |origin| u32::from(*origin)),
        );
    }
    ranges
}

/// A name prepared for one comparison, in reused buffers: the folded chars in lower case with
/// each run of separators one space and none at the ends, where each came from, and where words
/// start.
#[derive(Debug, Default)]
pub(crate) struct Words {
    pub chars: Vec<char>,
    origins: Vec<u32>,
    /// Indices into `chars` where words start: first, after a separator or another non-word
    /// char, and at camelCase humps.
    pub starts: Vec<usize>,
    /// Chars before the space that holds the extension's dot; all of them without one.
    pub stem: usize,
    len: u32,
}

impl Words {
    pub fn fill(&mut self, name: &str, folded: Option<&FoldedName>) {
        let len = nfc_len(name, folded);
        match folded {
            None => self.fill_from(name.char_indices().map(|(at, c)| (c, at as u32)), len),
            Some(folded) => self.fill_from(folded.chars(), len),
        }
    }

    fn fill_from(&mut self, chars: impl Iterator<Item = (char, u32)>, len: u32) {
        self.chars.clear();
        self.origins.clear();
        self.starts.clear();
        self.len = len;
        let (mut gap, mut dot, mut stem) = (None::<u32>, false, None);
        let mut previous: Option<char> = None;
        for (char, origin) in chars {
            if is_separator(char) {
                // Leading separators are dropped, so a leading dot (`.env`) is no extension.
                if !self.chars.is_empty() {
                    gap.get_or_insert(origin);
                    dot |= char == '.';
                }
            } else {
                if let Some(at) = gap.take() {
                    if std::mem::take(&mut dot) {
                        stem = Some(self.chars.len());
                    }
                    self.chars.push(' ');
                    self.origins.push(at);
                }
                let hump = previous.is_some_and(char::is_lowercase) && char.is_uppercase();
                if is_word(char) && (!previous.is_some_and(is_word) || hump) {
                    self.starts.push(self.chars.len());
                }
                for lower in char.to_lowercase() {
                    self.chars.push(lower);
                    self.origins.push(origin);
                }
            }
            previous = Some(char);
        }
        self.stem = stem.unwrap_or(self.chars.len());
    }

    /// Chars `[from, to)` as a range of the NFC name: the chars they came from, never splitting
    /// a char from the marks or expansions after it.
    pub fn range(&self, from: usize, to: usize) -> NameRange {
        let last = self.origins[to - 1];
        let end = self.origins[to..]
            .iter()
            .copied()
            .find(|origin| *origin > last);
        (self.origins[from], end.unwrap_or(self.len))
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

    fn words(name: &str) -> Words {
        let mut words = Words::default();
        let folded = (!name.is_ascii()).then(|| FoldedName::new(name));
        words.fill(name, folded.as_ref());
        words
    }

    #[test]
    fn folds_case_accents_width_and_separators() {
        assert_eq!(text(&fold_query("Résumé")), "resume");
        assert_eq!(text(&fold_query("README")), "readme");
        assert_eq!(text(&fold_query(" budget__2024.")), "budget 2024");
        assert_eq!(text(&fold_query("ＲＥＡＤＭＥ")), "readme");
        // Voicing marks make another kana, so they stay.
        assert_ne!(fold_query("ば"), fold_query("は"));
    }

    #[test]
    fn finds_word_starts_at_separators_and_humps() {
        let name = words("myFile-name_v2.md");
        assert_eq!(text(&name.chars), "myfile name v2 md");
        assert_eq!(name.starts, [0, 2, 7, 12, 15]);
        assert_eq!(name.stem, 14);
        let name = words("Ångström Notes.md");
        assert_eq!(text(&name.chars), "angstrom notes md");
        assert_eq!(name.starts, [0, 9, 15]);
        let name = words(".env");
        assert_eq!((text(&name.chars), name.stem), ("env".into(), 3));
    }

    #[test]
    fn maps_decomposed_names_to_nfc_offsets() {
        // "Cafe\u{301}" is stored decomposed on macOS; the renderer shows the NFC "Café".
        let name = words("Cafe\u{301} menu.md");
        assert_eq!(text(&name.chars), "cafe menu md");
        assert_eq!(name.range(0, 4), (0, 4));
        assert_eq!(name.range(5, 9), (5, 9));
        // NFC "é\u{302}x.md": the uncomposable circumflex stays with the highlighted "é".
        let marked = words("e\u{301}\u{302}x.md");
        assert_eq!(marked.range(0, 1), (0, 2));
        // A run of separators is one space that spans the whole run.
        let spaced = words("a - b.md");
        assert_eq!(text(&spaced.chars), "a b md");
        assert_eq!(spaced.range(0, 3), (0, 5));
        // Fuzzy matches report bytes of the folded text; runs merge.
        assert_eq!(byte_ranges(None, &[0, 3, 5, 6]), [(0, 1), (3, 4), (5, 7)]);
        let folded = FoldedName::new("Cafe\u{301}s.md");
        assert_eq!(byte_ranges(Some(&folded), &[3, 4]), [(3, 5)]);
        let cjk = FoldedName::new("报告-2026.md");
        assert_eq!(byte_ranges(Some(&cjk), &[3]), [(1, 2)]);
    }
}
