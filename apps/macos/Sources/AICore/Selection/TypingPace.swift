/// How the text of `text.write` arrives (contract: `text-calls.ts`) and how long each step may
/// take. With the user's typing setting on (``TextWriteParams/typing``), no reduced motion, and a
/// field whose caret can be followed (``PasteProgress``), the text is pasted a few characters at a
/// time like typing; otherwise it is one paste. Either way the write is deadline-driven: times are
/// offsets from the start of the write (the paste's first step, after the target app came forward
/// and its field was restored), the last chunk is due by ``budget`` and no wait runs past
/// ``deadline``, so whatever the text's length the last character is in the field within two
/// seconds.
///
/// Each chunk is sized when it is due, from the characters left and the time left: the time left
/// until ``budget`` divided by the cycle a chunk takes (``tick``, or the measured time from the
/// last chunk's due time to its confirmation when the field was slower) gives the chunks that still
/// fit, and the characters left are shared among them, never fewer than ``baseChunk`` a chunk. When
/// no further cycle fits, everything left goes in one final chunk. Short text therefore types at the
/// base rate, long text in larger chunks, and a slow field in fewer, larger chunks, all finishing on
/// time. Chunks hold whole characters (grapheme clusters), so an emoji sequence, a letter with its
/// combining marks or a "\r\n" is never split between two pastes.
public struct TypingPace: Sendable {
  /// The shortest time between two chunks' due times: 50 chunks a second, about as often as a field
  /// can take a ⌘V and report its caret. A chunk already late goes out at once.
  public static let tick: Duration = .milliseconds(20)
  /// Characters per tick at the base rate, about 200 characters a second, twice the former rate: a
  /// sentence still lands over several visible steps, and up to 240 characters type at this rate.
  public static let baseChunk = 4
  /// When the last chunk is due at the latest; longer text gets larger chunks instead.
  public static let budget: Duration = .milliseconds(1200)
  /// How far past ``budget`` a chunk other than the last may take to confirm, which leaves the last
  /// chunk at least `deadline - budget - margin` (0.4 s) to go in.
  public static let margin: Duration = .milliseconds(300)
  /// When every wait of the write ends at the latest, the last chunk's confirmation included; the
  /// 0.1 s left under two seconds covers timer slack and the clipboard's restoration.
  public static let deadline: Duration = .milliseconds(1900)

  /// One paste: `text`, due `due` after the write started; `isLast` when nothing follows it.
  public struct Chunk: Equatable, Sendable {
    public let text: String
    public let due: Duration
    public let isLast: Bool
  }

  private var rest: Substring
  private var restCount: Int
  private let paced: Bool
  private var lastDue: Duration?

  /// The pace of `text`: typed when `typing` is on, motion is not reduced and the field's caret
  /// can be followed (`caretTracked`); one paste otherwise. Without the caret nothing tells when a
  /// chunk is in, so a second chunk could replace the first before the target pasted it.
  public init(_ text: String, typing: Bool, reduceMotion: Bool, caretTracked: Bool) {
    rest = text[...]
    restCount = text.count
    paced = typing && !reduceMotion && caretTracked
  }

  /// The next chunk once the one before it is confirmed (or first), `elapsed` after the write
  /// started; nil when the text is all out. The chunks concatenate back to the text.
  public mutating func next(at elapsed: Duration) -> Chunk? {
    guard restCount > 0 else { return nil }
    let due: Duration
    let cycle: Duration
    if let lastDue {
      due = max(elapsed, lastDue + Self.tick)
      cycle = max(Self.tick, elapsed - lastDue)
    } else {
      due = elapsed
      cycle = Self.tick
    }
    lastDue = due
    let size = paced ? Self.size(of: restCount, at: due, cycle: cycle) : restCount
    let end = rest.index(rest.startIndex, offsetBy: size, limitedBy: rest.endIndex) ?? rest.endIndex
    let text = String(rest[..<end])
    rest = rest[end...]
    restCount = max(0, restCount - size)
    return Chunk(text: text, due: due, isLast: restCount == 0)
  }

  /// The characters of the chunk due at `due` with `count` left: shared among the cycles that
  /// still fit before ``budget``, all of them when only this one does.
  static func size(of count: Int, at due: Duration, cycle: Duration) -> Int {
    let left = budget - due
    guard left >= cycle else { return count }
    let slots = Int(left / cycle) + 1
    return min(count, max(baseChunk, (count + slots - 1) / slots))
  }

  /// How long the target gets to take `chunk` in, pasted `elapsed` after the write started: until
  /// ``deadline`` for the last chunk, until ``budget`` plus ``margin`` for any other, so no single
  /// wait pushes the write past two seconds and the last chunk keeps time to go in.
  public static func confirmationLimit(for chunk: Chunk, pastedAt elapsed: Duration) -> Duration {
    max(.zero, (chunk.isLast ? deadline : budget + margin) - elapsed)
  }
}
