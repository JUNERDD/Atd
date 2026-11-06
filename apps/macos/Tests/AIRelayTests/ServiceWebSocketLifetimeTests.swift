import AICore
import Foundation
import Testing

@testable import AIRelay

/// Owners retain their socket, and callbacks often retain the owner. Terminal connections must
/// release those callbacks so closing a page or reconnecting cannot retain the old owner graph.
@MainActor
@Suite("Service WebSocket callback lifetime", .serialized)
struct ServiceWebSocketLifetimeTests {
  @Test("Local and remote closure release callback owners", arguments: [false, true])
  func releasesOwners(remote: Bool) async throws {
    let harness = try await RelayHarness.started()
    defer { harness.tearDown() }
    let endpoint = try await harness.link.endpoint().get()
    for _ in 0..<12 {
      var owner: SocketCallbackOwner? = connectedOwner(endpoint)
      weak var released = owner
      weak var releasedSocket = owner?.socket
      try #require(await Task.until { released?.opened == true })
      if remote {
        owner?.socket?.send(
          #"{"type":"subscribe","epoch":0,"seq":0,"taskIds":["close-me"]}"#)
        try #require(await Task.until { released?.closeCode == 4001 })
      } else {
        owner?.socket?.close(code: 1000, reason: "Fixture finished.")
        #expect(owner?.closeCode == nil, "A local close must not deliver an onClose callback")
      }
      owner = nil
      try #require(
        await Task.until(.seconds(2)) { released == nil && releasedSocket == nil },
        "A closed socket retained its callback owner")
    }
  }

  private func connectedOwner(_ endpoint: ServiceEndpoint) -> SocketCallbackOwner {
    let owner = SocketCallbackOwner()
    owner.socket = ServiceWebSocket(
      endpoint: endpoint,
      events: .init(
        onOpen: { owner.opened = true },
        onText: { _ in owner.messages += 1 },
        onBinary: { owner.messages += 1 },
        onClose: { code, _ in owner.closeCode = code }))
    owner.socket?.start()
    return owner
  }
}

@MainActor
private final class SocketCallbackOwner {
  var socket: ServiceWebSocket?
  var opened = false
  var messages = 0
  var closeCode: UInt16?
}
