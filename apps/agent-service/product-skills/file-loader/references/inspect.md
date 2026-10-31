# Inspecting files with built-in macOS tools

Read this when `read` returned only a description and the task needs to know more about the file,
or when a file needs a tool to open. Every command below ships with macOS, only reads, and works on
a resource path even though resource files have no extension (`mdimport`, noted below, is the one
exception).

Quote paths, keep output short with `| head`, and put anything a command writes inside the task
folder. A command that would change, mount or run something is not inspection: ask the user first.

## Identify the file

- What kind of file it is: `file -b "<path>"`
- Its first bytes, for a format `file` does not know: `xxd -l 256 "<path>"`
- Readable text inside a binary, in place of `strings` (a developer-tools placeholder):
  `LC_ALL=C grep -aoE '[[:print:]]{8,}' "<path>" | head -50`

## Extracted files

When an `Extracted files:` pointer is available, inspect that folder before choosing a converter.
Search its `text.txt` with `grep`, open its `manifest.json` to find complete `sheets/` CSV files or
saved `images/`, and use `read` for the image paths the document names. Compute workbook totals
from the complete CSV files, with a CSV parser that handles quoted newlines; the document preview
can be truncated. If the manifest says whole sheets or images were omitted, treat them as
unavailable and inspect the original only with the tools the run has. These files are read-only;
write any derived output in the task folder.

## Text and documents

- Text in a legacy encoding that reads as garbage: `iconv -f GB18030 -t UTF-8 "<path>" | head -50`.
  Other common source encodings: `BIG5`, `SHIFT_JIS`, `EUC-KR`, `UTF-16`, `WINDOWS-1252`.
- Word, RTF, OpenDocument text, HTML or a web archive, when `read` could not extract it:
  `textutil -convert txt -stdout "<path>" | head -200`
- Property list, binary or XML: `plutil -p "<path>" | head -100`
- SQLite database: `sqlite3 -readonly "<path>" '.tables'`, then `'.schema <table>'` and
  `'select count(*) from <table>'`. Query with `-readonly` only.

## Archives

- Zip, and formats built on it (Office files, EPUB, `.jar`): list with `zipinfo -1 "<path>" | head -100`;
  read one member with `unzip -p "<path>" "<member>" | head -100`.
- Tar, including `.tgz`, `.tar.gz`, `.tar.bz2` and `.tar.xz`: list with `tar -tf "<path>" | head -100`;
  extract one member with `tar -xf "<path>" -C "<folder in the task folder>" "<member>"`.
- A single compressed file: `gzip -dc "<path>" | head` or `bzip2 -dc "<path>" | head`.
- Disk image: `hdiutil imageinfo "<path>"`. Mounting one changes the system, so ask first.
- 7z, RAR and bare `.xz` files have no built-in reader: tell the user, and offer to work with the
  files once they extract them.

## Media and images

- Audio, and the audio track of a video: `afinfo "<path>"` gives format, channels, sample rate and
  duration.
- Video or audio metadata: `mdimport -t -d2 "<copy with its extension>" 2>&1 | grep -E 'Duration|Pixel|Codecs|Bitrate'`.
  `mdimport` picks its importer by extension, so first copy a resource file into the task folder
  under its original name: `cp "<resource path>" "<task folder>/<original name>"`.
- Image details: `sips -g all "<path>"`
- Convert an image to PNG: `sips -s format png "<path>" --out "<folder in the task folder>/<name>.png"`

## Reporting

Describe what you found in the user's terms ("a SQLite database with 3 tables; `orders` has 1,240
rows") rather than pasting raw output. When a tool cannot open the file, say so and stop guessing:
it may be damaged, encrypted, or a format no built-in tool reads.
