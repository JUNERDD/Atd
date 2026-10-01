import Foundation
import Testing

@testable import AICore

@Suite("Upstream frame filter")
struct UpstreamFrameFilterTests {
  @Test("Close codes match RFC 6455")
  func closeCodes() {
    #expect(WebSocketCloseCode.policyViolation == 1008)
    #expect(WebSocketCloseCode.serviceRestart == 1012)
  }

  @Test(
    "Forwards subscribe and ping, reading only the type",
    arguments: [
      (#"{"type":"subscribe","epoch":0,"seq":0,"taskIds":["a"]}"#, UpstreamFrameType.subscribe),
      (#"{"type":"ping"}"#, .ping),
      ("  {\n\t\"type\" : \"ping\" \r\n}  ", .ping),
      (#"{"epoch":1,"seq":2,"type":"subscribe"}"#, .subscribe),
      (#"{"type":"ping"}"#, .ping),
      (#"{"type":"ping"}"#, .ping),
      (#"{"type":"subscribe","x":{"type":"capability.result","y":[1,{"type":"z"}]}}"#, .subscribe),
      (#"{"a":"}{\"type\":\"x\"","type":"ping","b":[true,null,-1.5e3]}"#, .ping),
    ])
  func forwards(text: String, type: UpstreamFrameType) {
    #expect(UpstreamFrameFilter.check(.text(text)) == .forward(type))
  }

  @Test(
    "Closes with 1008 for any other type or shape",
    arguments: [
      #"{"type":"capability.register","capabilities":["file.pick"]}"#,
      #"{"type":"capability.result","result":{}}"#,
      #"{"type":"unknown"}"#,
      #"{"type":"PING"}"#,
      #"{"type":"ping\u0000"}"#,
      #"{"type":" ping"}"#,
      #"{"type":1}"#,
      #"{"type":null}"#,
      #"{"type":["ping"]}"#,
      #"{"type":{"ping":1}}"#,
      #"{}"#,
      #"{"kind":"ping"}"#,
      #"[{"type":"ping"}]"#,
      #""ping""#,
      "",
      "not json",
      #"{"type":"ping"} x"#,
      #"{"type":"ping""#,
    ])
  func closesOthers(text: String) {
    #expect(isPolicyClose(UpstreamFrameFilter.check(.text(text))))
  }

  @Test(
    "Closes when duplicate type keys could make the service see another type",
    arguments: [
      #"{"type":"ping","type":"capability.result","result":{}}"#,
      #"{"type":"ping","type":"capability.register"}"#,
      #"{"type":"capability.register","type":"subscribe"}"#,
      #"{"type":"ping","type":"ping"}"#,
    ])
  func closesDuplicates(text: String) {
    #expect(isPolicyClose(UpstreamFrameFilter.check(.text(text))))
  }

  @Test("Closes binary and oversized frames")
  func closesBinaryAndLarge() {
    #expect(isPolicyClose(UpstreamFrameFilter.check(.binary(Data(#"{"type":"ping"}"#.utf8)))))
    let padding = String(repeating: "a", count: UpstreamFrameFilter.maxFrameBytes)
    let large = #"{"type":"ping","pad":""# + padding + #""}"#
    #expect(isPolicyClose(UpstreamFrameFilter.check(.text(large))))
  }

  @Test("The shell's own control frames are not page-legal, except ping and subscribe")
  func shellFrames() throws {
    #expect(UpstreamFrameFilter.check(.text(ControlStream.subscribe())) == .forward(.subscribe))
    #expect(UpstreamFrameFilter.check(.text(ControlStream.ping())) == .forward(.ping))
    #expect(isPolicyClose(UpstreamFrameFilter.check(.text(ControlStream.register([.filePick])))))
  }

  private func isPolicyClose(_ verdict: UpstreamVerdict) -> Bool {
    guard case .close(let code, let reason) = verdict else { return false }
    return code == WebSocketCloseCode.policyViolation && !reason.isEmpty
  }
}
