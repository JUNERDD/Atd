import AICore
import Foundation
import Testing

@testable import AIRelay

@Suite("Virtual socket service availability")
@MainActor
struct VirtualSocketAvailabilityTests {
  @Test(
    "Distinguishes starting (1013), stopped (1001), and failure states (1011) with structured close reasons",
    arguments: [
      ServiceUnavailable.starting,
      .failed("Error: startup failed in /Users/" + "alicecorp" + "/Library/service.lock"),
      .developmentServiceNotRunning,
      .invalidEndpoint(.notRunning),
      .stoppedTooOften,
      .stopped,
    ])
  func unavailable(_ reason: ServiceUnavailable) async {
    let source = UnavailableSource(reason: reason, lastFailure: "Error: previous crash")
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
    let expectedCode =
      switch reason {
      case .starting: 1013
      case .stopped: 1001
      default: 1011
      }
    #expect(close.code == expectedCode)
    #expect(close.reason.utf8.count <= 200)
    #expect(!close.reason.contains("alicecorp"))
    let descriptor = ServiceUnavailableDescriptor.describe(
      reason, lastFailure: source.lastFailureSummary)
    #expect(close.reason.hasPrefix("\(descriptor.errorCode): "))
    #expect(pipe.socketCount == 0)
  }
}

@MainActor
private final class UnavailableSource: ServiceEndpointSource {
  let reason: ServiceUnavailable
  let lastFailureSummary: String?
  var endpointMayHaveChanged: (@MainActor () -> Void)?

  init(reason: ServiceUnavailable, lastFailure: String? = nil) {
    self.reason = reason
    self.lastFailureSummary = lastFailure
  }

  func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    .failure(reason)
  }
}
