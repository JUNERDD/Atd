import Foundation
import Testing

@testable import AtdAI

@Suite struct ServerSentEventsTests {
  private func parse(_ body: String, pieceSize: Int? = nil) -> [ServerSentEvent] {
    var parser = ServerSentEventParser()
    let bytes = Data(body.utf8)
    guard let pieceSize else { return parser.push(bytes) }
    return bytes.pieces(of: pieceSize).flatMap { parser.push($0) }
  }

  @Test func blankLinesDispatchAndDataLinesJoin() {
    let events = parse("event: delta\ndata: one\ndata: two\n\ndata: three\n\n")
    #expect(
      events == [
        ServerSentEvent(type: "delta", data: "one\ntwo"),
        ServerSentEvent(data: "three"),
      ])
  }

  /// Every way of cutting the body (inside a CRLF, inside a character) gives the same events.
  @Test(arguments: [1, 2, 3, 5, 7, 11])
  func piecesOfAnySizeGiveTheSameEvents(pieceSize: Int) {
    let body =
      "\u{FEFF}: comment\r\nevent: a\r\ndata: 你好🙂\r\n\r\n"
      + "data: {\"x\":\"é\"}\rdata: second\r\r"
      + "data: last\n\n"
    let expected = [
      ServerSentEvent(type: "a", data: "你好🙂"),
      ServerSentEvent(data: "{\"x\":\"é\"}\nsecond"),
      ServerSentEvent(data: "last"),
    ]
    #expect(parse(body) == expected)
    #expect(parse(body, pieceSize: pieceSize) == expected)
  }

  @Test func commentsAndOtherFieldsAreIgnored() {
    let body = ": keep-alive\nid: 7\nretry: 1000\nunknown\ndata:tight\ndata:  spaced\n\n"
    #expect(parse(body) == [ServerSentEvent(data: "tight\n spaced")])
  }

  @Test func onlyLineBreaksSplitLines() {
    #expect(parse("data: a\u{2028}b\u{85}c\n\n") == [ServerSentEvent(data: "a\u{2028}b\u{85}c")])
  }

  @Test func eventsWithoutDataAreNotDispatched() {
    #expect(parse("event: ping\n\n").isEmpty)
    #expect(parse("data\n\n") == [ServerSentEvent(data: "")])
  }

  @Test func anEventCutOffBeforeItsBlankLineIsDropped() {
    #expect(parse("data: kept\n\ndata: cut off\n") == [ServerSentEvent(data: "kept")])
  }

  @Test func doneMarksTheEndOfAnOpenAIStream() throws {
    let decoder = OpenAIAnswerDecoder()
    let done = try decoder.read(ServerSentEvent(data: "[DONE]"))
    #expect(done.text.isEmpty && done.done)
  }
}
