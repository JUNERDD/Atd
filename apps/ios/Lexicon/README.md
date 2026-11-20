# Pinyin lexicon

`pinyin_simp.dict.yaml` is the dictionary of
[rime/rime-pinyin-simp](https://github.com/rime/rime-pinyin-simp) at commit
`0c6861ef7420ee780270ca6d993d18d4101049d0`, unchanged. It derives from the Android Pinyin IME, and
both are under the Apache License 2.0 (`LICENSE`, `AUTHORS`). The app lists it under 开源许可.

- Source SHA-256: `e341598343a0f0f2035bb1aafc34a7f3bb7887deeecb3f60796262aaa2983e6b`
- `node scripts/lexicon.mjs` builds `Sources/AtdPinyin/Resources/pinyin.lexicon` from it.
- `pnpm --filter @atd/ios lexicon:check` fails when the checked-in lexicon is not what this source
  builds, or when the source no longer matches the checksum above.

To move to another revision, replace the dictionary, update the commit and the checksum here, and
rebuild the lexicon.

## Format

The keyboard maps the file read-only and reads it in place, so only the pages a lookup touches
are resident. All integers are little-endian.

| Part      | Layout                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Header    | 48 bytes: `ATDPY001`, then u32 syllable count, word count, syllable, word, text index and text offsets, text length, ln(total weight) |
| Syllables | 8 bytes each, sorted: u8 length and up to 7 ASCII letters. Ids start at 1, so a typed prefix covers a contiguous id range             |
| Words     | 16 bytes each: four u16 syllable ids (0 pads a shorter word), u8 syllable count, u8 text length, u16 score, u32 text offset           |
| Index     | u32 word numbers sorted by text (UTF-8 bytes), then score: associations and readings                                                  |
| Text      | The words' UTF-8 bytes                                                                                                                |

Words are sorted by their syllable ids, shorter words first, then by score. A score is
`round(ln(weight + 1) × 2000)`; the header's total uses the same scale.
