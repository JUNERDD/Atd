import AICore
import Foundation

/// The compiled route manifest of the service instance the relay talks to (decisions R1, Q7).
/// It is fetched after every connect or restart, and on an epoch conflict (R4); requests wait
/// for a fetch in flight up to ``RelayPolicy/manifestWait`` and then answer 503. A manifest that
/// cannot be fetched, decoded or compiled denies everything (fail closed): no stale or partial
/// allow-list is ever used.
@MainActor
final class RouteManifestCache {
  typealias Fetch = @MainActor (ServiceEndpoint) async throws -> RouteManifest

  private let fetch: Fetch
  private let wait: Duration
  private var instance: ServiceEndpoint?
  private var matcher: RouteMatcher?
  private var loading = false
  /// Bumped whenever the cached instance changes, so a fetch for an older one is discarded.
  private var generation = 0
  private let waiters = BoundedWaiters<RouteMatcher>()

  init(wait: Duration = RelayPolicy.manifestWait, fetch: Fetch? = nil) {
    self.wait = wait
    self.fetch = fetch ?? { try await ShellClient(endpoint: $0).routeManifest() }
  }

  /// The matcher for `endpoint`'s instance, or nil (answer 503) when none is ready in time.
  func matcher(for endpoint: ServiceEndpoint) async -> RouteMatcher? {
    if let instance, instance.isSameInstance(as: endpoint) {
      if let matcher { return matcher }
    } else {
      reset(to: endpoint)
    }
    if !loading { load(endpoint) }
    return await waiters.wait(atMost: wait)
  }

  /// Drops the manifest (an epoch conflict): the next request fetches a new one.
  /// A fetch already in flight is newer than the manifest that conflicted, so it is kept.
  func invalidate() {
    guard !loading else { return }
    generation += 1
    matcher = nil
  }

  private func reset(to endpoint: ServiceEndpoint?) {
    generation += 1
    instance = endpoint
    matcher = nil
    loading = false
    waiters.resumeAll(with: nil)
  }

  private func load(_ endpoint: ServiceEndpoint) {
    loading = true
    let generation = generation
    Task { @MainActor in
      var compiled: RouteMatcher?
      do {
        compiled = try RouteMatcher(manifest: try await fetch(endpoint))
      } catch {
        RelayLog.relay.error("The route manifest is unavailable: \(String(describing: error))")
      }
      guard generation == self.generation else { return }
      loading = false
      matcher = compiled
      waiters.resumeAll(with: compiled)
    }
  }
}
