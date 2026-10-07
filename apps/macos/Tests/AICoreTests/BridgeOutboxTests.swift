import Foundation
import Testing

@testable import AICore

@Suite("Bridge outbox (S6)")
struct BridgeOutboxTests {
  static func frame(_ data: String) -> SocketFrame {
    .message(.init(socketId: "s", data: data))
  }

  static func frames(_ message: SwiftMessage?) -> [String]? {
    guard case .event(.socketFrames(let event))? = message else { return nil }
    return event.frames.map { frame in
      if case .message(let message) = frame { return message.data }
      return "?"
    }
  }

  static let command = SwiftMessage.event(.shortcutCommand(.init(id: "c1")))
  static let visible = NativeEvent.windowVisibility(.init(visible: true))

  static func ready() -> BridgeOutbox {
    var outbox = BridgeOutbox()
    _ = outbox.pageDidBecomeReady()
    return outbox
  }

  @Test("Nothing goes out before the page is ready; then states come first")
  func waitsForReady() {
    var outbox = BridgeOutbox()
    #expect(outbox.post(Self.command, scope: .app) == .none)
    #expect(outbox.setState(Self.visible) == .none)
    #expect(outbox.next() == nil)
    #expect(outbox.pageDidBecomeReady() == .flush)
    #expect(outbox.next() == .event(Self.visible))
    #expect(outbox.completed(delivered: true) == .flush)
    #expect(outbox.next() == Self.command)
  }

  @Test("The first message schedules one flush; frames of the same turn share a call")
  func batchesOneTurn() {
    var outbox = Self.ready()
    #expect(outbox.post(frame: Self.frame("1"), bytes: 10) == .flush)
    #expect(outbox.post(frame: Self.frame("2"), bytes: 10) == .none)
    #expect(outbox.post(frame: Self.frame("3"), bytes: 10) == .none)
    #expect(Self.frames(outbox.next()) == ["1", "2", "3"])
    #expect(outbox.isInFlight)
    #expect(outbox.pendingCount == 0)
  }

  @Test("Keeps one call in flight; its completion flushes the backlog as one batch")
  func oneInFlight() {
    var outbox = Self.ready()
    _ = outbox.post(frame: Self.frame("0"), bytes: 1)
    #expect(Self.frames(outbox.next()) == ["0"])
    for index in 1...500 { #expect(outbox.post(frame: Self.frame("\(index)"), bytes: 1) == .none) }
    #expect(outbox.next() == nil)
    #expect(outbox.completed(delivered: true) == .flush)
    #expect(Self.frames(outbox.next()) == (1...500).map(String.init))
    #expect(outbox.completed(delivered: true) == .none)
    #expect(outbox.post(frame: Self.frame("x"), bytes: 1) == .flush)
  }

  @Test("Frames join only while consecutive, so results and events keep their order")
  func order() {
    var outbox = Self.ready()
    _ = outbox.post(frame: Self.frame("a"), bytes: 1)
    _ = outbox.post(.result(id: 1, value: .null), scope: .document)
    _ = outbox.post(frame: Self.frame("b"), bytes: 1)
    _ = outbox.post(frame: Self.frame("c"), bytes: 1)
    #expect(Self.frames(outbox.next()) == ["a"])
    _ = outbox.completed(delivered: true)
    #expect(outbox.next() == .result(id: 1, value: .null))
    _ = outbox.completed(delivered: true)
    #expect(Self.frames(outbox.next()) == ["b", "c"])
  }

  @Test("Splits frames at the byte limit but always sends a first frame, however large")
  func splits() {
    var outbox = BridgeOutbox(frameBatchBytes: 100)
    _ = outbox.pageDidBecomeReady()
    for (data, bytes) in [("a", 60), ("b", 30), ("c", 20), ("huge", 1000), ("d", 1)] {
      _ = outbox.post(frame: Self.frame(data), bytes: bytes)
    }
    var batches: [[String]] = []
    while let batch = Self.frames(outbox.next()) {
      batches.append(batch)
      _ = outbox.completed(delivered: true)
    }
    #expect(batches == [["a", "b"], ["c"], ["huge"], ["d"]])
  }

  @Test("States send only their latest changed value, and again to every ready page")
  func latestState() {
    var outbox = Self.ready()
    _ = outbox.setState(.windowActive(.init(active: true)))
    _ = outbox.setState(.windowActive(.init(active: false)))
    #expect(outbox.next() == .event(.windowActive(.init(active: false))))
    _ = outbox.completed(delivered: true)
    #expect(outbox.setState(.windowActive(.init(active: false))) == .none)
    outbox.pageDidUnload()
    _ = outbox.pageDidBecomeReady()
    #expect(outbox.next() == .event(.windowActive(.init(active: false))))
  }

  @Test("A crash keeps app messages in order and drops the page's results and frames")
  func crash() {
    var outbox = Self.ready()
    _ = outbox.post(Self.command, scope: .app)
    #expect(outbox.next() == Self.command)
    _ = outbox.post(.event(.editCommand(.init(command: .undo))), scope: .app)
    _ = outbox.post(.error(id: 3, message: "x"), scope: .document)
    _ = outbox.post(frame: Self.frame("f"), bytes: 1)
    outbox.pageDidUnload()
    #expect(outbox.completed(delivered: false) == .none)
    #expect(outbox.next() == nil)
    _ = outbox.pageDidBecomeReady()
    #expect(outbox.next() == Self.command)
    _ = outbox.completed(delivered: true)
    #expect(outbox.next() == .event(.editCommand(.init(command: .undo))))
    _ = outbox.completed(delivered: true)
    #expect(outbox.next() == nil)
  }

  @Test("Encodes the contract's envelopes and frames")
  func encodes() throws {
    let message = SwiftMessage.event(
      .socketFrames(
        .init(frames: [
          .open(.init(socketId: "s")), .close(.init(socketId: "s", code: 1012, reason: "r")),
        ])))
    let json = String(decoding: try JSONEncoder.sorted.encode(message), as: UTF8.self)
    #expect(
      json
        == #"{"event":"socket.frames","payload":{"frames":[{"kind":"open","socketId":"s"},"#
        + #"{"code":1012,"kind":"close","reason":"r","socketId":"s"}]},"type":"event"}"#)
    let result = SwiftMessage.result(
      id: 7,
      value: try JSONValue(
        encoding: AppStateResult(
          pinned: true, showInDock: false, openAtLogin: nil, widgetsAvailable: true)))
    #expect(
      String(decoding: try JSONEncoder.sorted.encode(result), as: UTF8.self)
        == #"{"id":7,"type":"result","value":{"openAtLogin":null,"pinned":true,"showInDock":false,"#
        + #""widgetsAvailable":true}}"#
    )
  }
}

@Suite("Page messages by the bridge contract")
struct JsMessageTests {
  static func decode(_ json: String) -> JsMessage? {
    try? JSONDecoder().decode(JsMessage.self, from: Data(json.utf8))
  }

  @Test("Decodes the three socket posts")
  func socketPosts() {
    #expect(
      Self.decode(
        #"{"type":"post","method":"socket.open","params":{"socketId":"s-1","path":"/v1/stream"}}"#)
        == .post(.socketOpen(.init(socketId: "s-1"))))
    #expect(
      Self.decode(#"{"type":"post","method":"socket.send","params":{"socketId":"s1","data":"{}"}}"#)
        == .post(.socketSend(.init(socketId: "s1", data: "{}"))))
    #expect(
      Self.decode(
        #"{"type":"post","method":"socket.close","params":{"socketId":"s1","code":4000,"reason":"bye"}}"#
      )
        == .post(.socketClose(.init(socketId: "s1", code: 4000, reason: "bye"))))
  }

  @Test("Refuses malformed posts and calls")
  func refuses() {
    let bodies = [
      #"{"type":"post","method":"socket.open","params":{"socketId":"","path":"/v1/stream"}}"#,
      #"{"type":"post","method":"socket.open","params":{"socketId":"s","path":"/v1/other"}}"#,
      #"{"type":"post","method":"socket.open","params":{"socketId":"s","path":"/v1/stream","x":1}}"#,
      #"{"type":"post","method":"socket.send","params":{"socketId":"s","data":4}}"#,
      #"{"type":"post","method":"socket.close","params":{"socketId":"s","code":999,"reason":""}}"#,
      #"{"type":"post","method":"socket.subscribe","params":{}}"#,
      #"{"type":"call","id":0,"method":"window.show","params":{}}"#,
      #"{"type":"call","id":1,"method":"link.open","params":{"url":"file:///etc/hosts"}}"#,
      #"{"type":"call","id":1,"method":"window.show","params":{},"extra":true}"#,
    ]
    for body in bodies { #expect(Self.decode(body) == nil, "\(body)") }
  }

  @Test("Decodes typed calls, nullable members and literal unions")
  func calls() {
    #expect(
      Self.decode(
        #"{"type":"call","id":4,"method":"settings.open","params":{"commandId":null,"section":"general"}}"#
      ) == .call(id: 4, .settingsOpen(.init(commandId: nil, section: "general"))))
    #expect(
      Self.decode(
        #"{"type":"call","id":5,"method":"artifact","params":{"artifactId":"a","operation":"copyPath"}}"#
      )
        == .call(id: 5, .artifact(.init(artifactId: "a", operation: .copyPath))))
    #expect(
      Self.decode(#"{"type":"post","method":"language.set","params":{"language":"zh-CN"}}"#)
        == .post(.languageSet(.init(language: .zhCN))))
  }
}

extension JSONEncoder {
  static var sorted: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }
}
