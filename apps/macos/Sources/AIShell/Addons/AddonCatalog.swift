import AICore
import AIRelay
import Foundation
import OSLog

/// The shell's copy of the active add-on installs. The service owns the
/// installs; the shell reads `GET /v1/addons` whenever the control stream connects and on each
/// `addons` invalidation, keeps only paths inside the connected data directory's `addons`
/// directory (``AddonInstalls``), and tells its consumers when the result differs.
///
/// Reads never overlap: a change that arrives during one is read again after it. A read that
/// fails keeps the last known installs and is tried again after a short backoff (at most
/// ``retryDelays``), so a missed removal does not leave deleted paths in use; a newer refresh
/// replaces the pending retry, and a new connection reads again anyway. Consumers still check
/// that a path exists before they run it.
final class AddonCatalog {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "addons")

  private let services: ShellServices
  private(set) var installs = AddonInstalls.none
  /// The installs changed; called on the main actor with the new value.
  var onChange: ((AddonInstalls) -> Void)?
  private var reading: Task<Void, Never>?
  private var readAgain = false
  /// The waits before the retries of a failed read.
  static let retryDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8)]
  private var retry: Task<Void, Never>?
  private var failures = 0

  init(services: ShellServices) {
    self.services = services
  }

  /// Reads the installs again, now or right after the read in progress.
  func refresh() {
    retry?.cancel()
    retry = nil
    failures = 0
    guard reading == nil else {
      readAgain = true
      return
    }
    startRead()
  }

  private func startRead() {
    reading = Task { [weak self] in
      let succeeded = await self?.read() ?? true
      self?.finishRead(succeeded: succeeded)
    }
  }

  /// Reads once; false when the service could not be read.
  private func read() async -> Bool {
    let dataDirectory = services.dataDirectory
    let read: AddonInstalls
    do {
      read = try await services.client().addonInstalls(dataDirectory: dataDirectory)
    } catch {
      Self.log.error(
        "Could not read the add-ons: \(String(describing: error), privacy: .public)")
      return false
    }
    for (id, problem) in read.refused.sorted(by: { $0.key < $1.key }) {
      Self.log.error(
        "Ignoring the \(id, privacy: .public) add-on: \(problem, privacy: .public)")
    }
    guard read.entries != installs.entries else { return true }
    installs = read
    onChange?(read)
    return true
  }

  private func finishRead(succeeded: Bool) {
    reading = nil
    if readAgain {
      readAgain = false
      return refresh()
    }
    if succeeded { failures = 0 }
    guard !succeeded, failures < Self.retryDelays.count else { return }
    let delay = Self.retryDelays[failures]
    failures += 1
    retry = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled, let self else { return }
      self.retry = nil
      if self.reading == nil { self.startRead() }
    }
  }
}
