import Foundation
import Testing

@testable import AICore

@Suite("Frame delivery queue (S6)")
struct FrameDeliveryQueueTests {
  @Test("The first frame schedules one flush; frames of the same turn join it")
  func batchesOneTurn() {
    var queue = FrameDeliveryQueue<Int>()
    #expect(queue.enqueue(1, bytes: 10) == .flush)
    #expect(queue.enqueue(2, bytes: 10) == .none)
    #expect(queue.enqueue(3, bytes: 10) == .none)
    #expect(queue.takeBatch() == [1, 2, 3])
    #expect(queue.isInFlight)
    #expect(queue.pendingCount == 0)
  }

  @Test("Keeps one call in flight; its completion flushes the whole backlog as one batch")
  func oneInFlight() {
    var queue = FrameDeliveryQueue<Int>()
    _ = queue.enqueue(1, bytes: 1)
    #expect(queue.takeBatch() == [1])
    for frame in 2...500 { #expect(queue.enqueue(frame, bytes: 1) == .none) }
    #expect(queue.takeBatch().isEmpty)
    #expect(queue.completed() == .flush)
    #expect(queue.takeBatch() == Array(2...500))
    #expect(queue.completed() == .none)
    #expect(!queue.isInFlight)
  }

  @Test("After an idle completion the next frame schedules a flush again")
  func idleAgain() {
    var queue = FrameDeliveryQueue<Int>()
    _ = queue.enqueue(1, bytes: 1)
    _ = queue.takeBatch()
    #expect(queue.completed() == .none)
    #expect(queue.enqueue(2, bytes: 1) == .flush)
    #expect(queue.takeBatch() == [2])
  }

  @Test("Splits at the byte limit but always sends a first frame, however large")
  func splits() {
    var queue = FrameDeliveryQueue<String>(batchByteLimit: 100)
    _ = queue.enqueue("a", bytes: 60)
    _ = queue.enqueue("b", bytes: 30)
    _ = queue.enqueue("c", bytes: 20)
    _ = queue.enqueue("huge", bytes: 1000)
    _ = queue.enqueue("d", bytes: 1)
    #expect(queue.takeBatch() == ["a", "b"])
    #expect(queue.completed() == .flush)
    #expect(queue.takeBatch() == ["c"])
    #expect(queue.completed() == .flush)
    #expect(queue.takeBatch() == ["huge"])
    #expect(queue.completed() == .flush)
    #expect(queue.takeBatch() == ["d"])
    #expect(queue.completed() == .none)
  }

  @Test("Keeps arrival order across batches and compaction")
  func order() {
    var queue = FrameDeliveryQueue<Int>(batchByteLimit: 7)
    var delivered: [Int] = []
    var pending = queue.enqueue(0, bytes: 1) == .flush
    for frame in 1..<5000 {
      _ = queue.enqueue(frame, bytes: 1)
      if frame % 3 == 0, pending {
        delivered += queue.takeBatch()
        pending = queue.completed() == .flush
      }
    }
    while pending || queue.pendingCount > 0 {
      delivered += queue.takeBatch()
      pending = queue.completed() == .flush
    }
    #expect(delivered == Array(0..<5000))
  }

  @Test("Discarding drops waiting frames; the call in flight still completes")
  func discard() {
    var queue = FrameDeliveryQueue<Int>()
    _ = queue.enqueue(1, bytes: 1)
    _ = queue.takeBatch()
    _ = queue.enqueue(2, bytes: 1)
    queue.discardPending()
    #expect(queue.pendingCount == 0)
    #expect(queue.completed() == .none)
    #expect(queue.enqueue(3, bytes: 1) == .flush)
    #expect(queue.takeBatch() == [3])
  }

  @Test("A scheduled flush that finds nothing leaves no call in flight")
  func emptyFlush() {
    var queue = FrameDeliveryQueue<Int>()
    _ = queue.enqueue(1, bytes: 1)
    queue.discardPending()
    #expect(queue.takeBatch().isEmpty)
    #expect(!queue.isInFlight)
    #expect(queue.enqueue(2, bytes: 1) == .flush)
  }
}

@Suite("Virtual socket bridge contract")
struct SocketBridgeContractTests {
  @Test("Decodes the three page commands")
  func commands() {
    #expect(
      VirtualSocketCommand(messageBody: ["op": "open", "socketId": "s-1"] as NSDictionary)
        == .open(socketId: "s-1"))
    #expect(
      VirtualSocketCommand(messageBody: ["op": "send", "socketId": "s1", "text": "{}"])
        == .send(socketId: "s1", text: "{}"))
    let close: [String: Any] = [
      "op": "close", "socketId": "s1", "code": NSNumber(value: 4000), "reason": "bye",
    ]
    #expect(
      VirtualSocketCommand(messageBody: close) == .close(socketId: "s1", code: 4000, reason: "bye"))
    #expect(
      VirtualSocketCommand(messageBody: ["op": "close", "socketId": "s1"])
        == .close(socketId: "s1", code: nil, reason: ""))
  }

  @Test("Drops close codes a browser page could not send")
  func closeCodes() {
    let codes: [NSNumber] = [1001, 1008, 1012, 2999, 5000, 0, 1000.5].map { NSNumber(value: $0) }
    for code in codes {
      let body: [String: Any] = ["op": "close", "socketId": "s", "code": code]
      #expect(
        VirtualSocketCommand(messageBody: body) == .close(socketId: "s", code: nil, reason: ""))
    }
  }

  @Test("Refuses malformed commands and unsafe socket ids")
  func refuses() {
    let bodies: [Any] = [
      "open", ["op": "open"], ["op": "open", "socketId": ""],
      ["op": "open", "socketId": String(repeating: "a", count: 65)],
      ["op": "open", "socketId": "<img>"], ["op": "open", "socketId": 3],
      ["op": "send", "socketId": "s"], ["op": "send", "socketId": "s", "text": 4],
      ["op": "subscribe", "socketId": "s"],
    ]
    for body in bodies { #expect(VirtualSocketCommand(messageBody: body) == nil) }
  }

  @Test("Cuts long close reasons to 123 UTF-8 bytes at a character")
  func reason() {
    let long = String(repeating: "界", count: 60)
    let command = VirtualSocketCommand(messageBody: [
      "op": "close", "socketId": "s", "reason": long,
    ])
    guard case .close(_, _, let reason)? = command else {
      Issue.record("Expected a close.")
      return
    }
    #expect(reason.utf8.count == 123)
    #expect(long.hasPrefix(reason))
  }

  @Test("Delivers frames as { socketId, kind, data }")
  func frames() {
    let open = VirtualSocketFrame.open("s").bridgeObject()
    #expect(open["kind"] as? String == "open")
    #expect(open["data"] is NSNull)
    let message = VirtualSocketFrame.message("s", text: #"{"type":"pong"}"#).bridgeObject()
    #expect(message["socketId"] as? String == "s")
    #expect(message["data"] as? String == #"{"type":"pong"}"#)
    let close = VirtualSocketFrame.close("s", code: 1012, reason: "restart").bridgeObject()
    let data = close["data"] as? [String: Any]
    #expect(data?["code"] as? Int == 1012)
    #expect(data?["reason"] as? String == "restart")
  }
}
