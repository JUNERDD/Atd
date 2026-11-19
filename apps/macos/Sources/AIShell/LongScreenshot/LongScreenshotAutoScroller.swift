import AIComputerDriverKit
import AICore
import CoreGraphics
import Foundation

/// Auto-scroll driver for the long screenshot's live phase: delivers window-routed continuous
/// pixel scroll events to the target window through `atd-computer-driver` so the real cursor
/// never moves into the selection, falling back to `CGEvent.postToPid` only when no window id is
/// known or the bundled driver cannot run.
@MainActor
final class LongScreenshotAutoScroller {
  private var client: DriverClient?
  private var generation: Int?
  private var lastGeneration = 0
  private var unavailable = false
  private var preparing: Task<Bool, Never>?
  private(set) var driverPID: pid_t?

  private static let logURL = FileManager.default.temporaryDirectory
    .appending(path: "atd-long-screenshot-driver.log", directoryHint: .notDirectory)

  /// Ensures `atd-computer-driver` is running with `windowEvents` support; returns false when the
  /// bundled helper is missing, fails its handshake, or cannot start.
  func prepare() async -> Bool {
    if unavailable { return false }
    if let preparing { return await preparing.value }
    if let client, generation != nil, await client.processIdentifier != nil {
      return generation != nil && self.client === client
    }
    if unavailable { return false }
    if let preparing { return await preparing.value }
    let task = Task<Bool, Never> { [weak self] in
      guard let self else { return false }
      return await self.launchDriver()
    }
    preparing = task
    return await task.value
  }

  /// Sends one continuous pixel scroll step towards `direction` at Quartz `location` to `windowID`
  /// of `pid`.
  func scroll(
    pid: pid_t, windowID: CGWindowID?, direction: LongScreenshotDirection, points: CGFloat,
    at location: CGPoint
  ) async -> Bool {
    let delta = Int32(points.rounded())
    guard delta > 0 else { return false }
    let wheel1 = direction == .down ? -delta : delta
    if let windowID, await prepare(), let client {
      let request = DriverPerformRequest(
        target: DriverTarget(pid: Int(pid), windowId: Int(windowID)),
        primitive: .scroll(
          point: DriverPoint(x: Double(location.x), y: Double(location.y)), deltaX: 0,
          deltaY: Double(wheel1), pixels: true),
        routeAllow: [.scroll], deadlineMilliseconds: 1_500, userTypedWithinGuard: false)
      switch await client.send(.perform(request), timeout: .seconds(2)) {
      case .success(.perform(let performed)):
        return performed.receipt.dispatched
      case .failure(.cancelled):
        return false
      case .failure(.refused(let failure)) where failure.code == .targetGone:
        return false
      case .success, .failure:
        guard !Task.isCancelled, self.client === client else { return false }
        resetIfActive(client, markUnavailable: true)
        Task { await client.stop() }
      }
    }
    guard !Task.isCancelled else { return false }
    return Self.postToProcess(pid: pid, wheel1: wheel1, at: location)
  }

  /// Stops the driver process and clears local state; safe to call repeatedly.
  func stop() {
    preparing?.cancel()
    preparing = nil
    generation = nil
    driverPID = nil
    let active = client
    client = nil
    if let active { Task { await active.stop() } }
  }

  // MARK: Private

  private func launchDriver() async -> Bool {
    defer { if !Task.isCancelled { preparing = nil } }
    guard !unavailable, !Task.isCancelled else { return false }
    guard let executable = DriverLaunch.bundled(),
      FileManager.default.isExecutableFile(atPath: executable.path(percentEncoded: false))
    else {
      unavailable = true
      return false
    }
    let client =
      self.client
      ?? DriverClient { [weak self] ended in
        Task { @MainActor in self?.driverExited(ended) }
      }
    self.client = client
    lastGeneration += 1
    let next = lastGeneration
    generation = next
    driverPID = nil
    do {
      let launch = DriverLaunch(executable: executable, log: Self.logURL, generation: next)
      let hello = try await client.start(launch, timeout: .seconds(3))
      let hasWindowEvents = hello.capabilities.contains {
        $0.name == DriverCapabilityName.windowEvents && $0.available
      }
      let pid = await client.processIdentifier
      guard !Task.isCancelled, self.client === client, generation == next,
        hello.protocolVersion == driverProtocolVersion, hasWindowEvents, let pid
      else {
        resetIfActive(client, generation: next, markUnavailable: !Task.isCancelled)
        await client.stop()
        return false
      }
      driverPID = pid
      return true
    } catch {
      resetIfActive(client, generation: next, markUnavailable: !Task.isCancelled)
      await client.stop()
      return false
    }
  }

  private func resetIfActive(
    _ client: DriverClient, generation expected: Int? = nil, markUnavailable: Bool
  ) {
    if expected == nil || generation == expected {
      generation = nil
      driverPID = nil
    }
    if self.client === client {
      self.client = nil
      if markUnavailable { unavailable = true }
    }
  }

  private func driverExited(_ ended: Int) {
    guard generation == ended else { return }
    generation = nil
    driverPID = nil
  }

  private static func postToProcess(pid: pid_t, wheel1: Int32, at location: CGPoint) -> Bool {
    guard let source = CGEventSource(stateID: .privateState),
      let event = CGEvent(
        scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: wheel1, wheel2: 0,
        wheel3: 0)
    else { return false }
    event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    event.setIntegerValueField(.eventSourceUserData, value: LongScreenshotCapture.scrollEventMarker)
    event.location = location
    event.flags = []
    event.postToPid(pid)
    return true
  }
}
