import AICore
import Foundation
import Testing

@testable import AIRelay

@Suite("Virtual socket service availability")
@MainActor
struct VirtualSocketAvailabilityTests {
  @Test(
    "Distinguishes an active startup from an unavailable service",
    arguments: [
      ServiceUnavailable.starting, .failed("Synthetic startup failure"),
      .developmentServiceNotRunning, .invalidEndpoint(.notRunning), .stoppedTooOften, .stopped,
    ])
  func unavailable(_ reason: ServiceUnavailable) async {
    let source = UnavailableSource(reason: reason)
    var frames: [SocketFrame] = []
    let pipe = VirtualSocketPipe(link: ServiceLink(source: source)) { frames.append($0) }
    defer { pipe.invalidate() }
    pipe.open(.init(socketId: "startup"))
    #expect(await Task.until { !frames.isEmpty })
    guard case .close(let close) = frames.first else {
      Issue.record("An unavailable service must close the virtual socket.")
      return
    }
    #expect(close.socketId == "startup")
    #expect(close.code == (reason == .starting ? 1013 : 1011))
    #expect(pipe.socketCount == 0)
  }
}

@MainActor
private final class UnavailableSource: ServiceEndpointSource {
  let reason: ServiceUnavailable
  var endpointMayHaveChanged: (@MainActor () -> Void)?

  init(reason: ServiceUnavailable) {
    self.reason = reason
  }

  func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    .failure(reason)
  }
}
