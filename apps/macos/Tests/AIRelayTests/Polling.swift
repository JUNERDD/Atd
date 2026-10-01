import Foundation

extension Task where Success == Never, Failure == Never {
  /// Polls `condition` on the main actor until it holds or `timeout` passes.
  @MainActor
  static func until(
    _ timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool
  ) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while ContinuousClock.now < deadline {
      if condition() { return true }
      try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
  }
}
