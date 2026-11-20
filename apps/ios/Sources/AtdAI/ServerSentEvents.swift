import Foundation

/// One dispatched event of a `text/event-stream` body.
struct ServerSentEvent: Sendable, Equatable {
  /// `message` unless an `event:` field named it.
  var type: String
  /// The event's `data:` lines joined with newlines.
  var data: String

  init(type: String = "message", data: String) {
    self.type = type
    self.data = data
  }
}

/// Splits a `text/event-stream` body into events as its bytes arrive, by the WHATWG rules: a line
/// ends with CRLF, LF or CR (a CRLF split across two chunks is still one ending), a line starting
/// with `:` is a comment, `data:` lines join with newlines, and a blank line dispatches the event.
/// An event the stream cuts off before its blank line is dropped.
///
/// Lines are split on bytes before decoding, so a multi-byte character divided between chunks
/// arrives whole, and only these three endings split a line (not U+2028, which JSON strings may
/// contain unescaped).
struct ServerSentEventParser {
  private var line: [UInt8] = []
  private var afterCarriageReturn = false
  private var atStart = true
  private var eventType = ""
  private var data = ""

  /// Reads the next bytes and returns the events they complete.
  mutating func push(_ bytes: some Sequence<UInt8>) -> [ServerSentEvent] {
    var events: [ServerSentEvent] = []
    for byte in bytes {
      if afterCarriageReturn {
        afterCarriageReturn = false
        if byte == lineFeed { continue }
      }
      switch byte {
      case lineFeed:
        if let event = endLine() { events.append(event) }
      case carriageReturn:
        afterCarriageReturn = true
        if let event = endLine() { events.append(event) }
      default:
        line.append(byte)
      }
    }
    return events
  }

  private mutating func endLine() -> ServerSentEvent? {
    defer { line.removeAll(keepingCapacity: true) }
    if atStart {
      atStart = false
      // A byte order mark before the first line is not part of it.
      if line.starts(with: byteOrderMark) { line.removeFirst(byteOrderMark.count) }
    }
    guard !line.isEmpty else { return dispatch() }
    guard line[0] != colon else { return nil }
    let text = String(decoding: line, as: UTF8.self)
    let field: Substring
    var value: Substring = ""
    if let separator = text.firstIndex(of: ":") {
      field = text[..<separator]
      value = text[text.index(after: separator)...]
      if value.first == " " { value = value.dropFirst() }
    } else {
      field = text[...]
    }
    switch field {
    case "event": eventType = String(value)
    case "data": data += value + "\n"
    // `id` and `retry` matter to reconnecting clients; a model answer is never resumed.
    default: break
    }
    return nil
  }

  private mutating func dispatch() -> ServerSentEvent? {
    defer {
      eventType = ""
      data = ""
    }
    guard !data.isEmpty else { return nil }
    return ServerSentEvent(
      type: eventType.isEmpty ? "message" : eventType, data: String(data.dropLast()))
  }
}

private let lineFeed: UInt8 = 0x0A
private let carriageReturn: UInt8 = 0x0D
private let colon: UInt8 = 0x3A
private let byteOrderMark: [UInt8] = [0xEF, 0xBB, 0xBF]
