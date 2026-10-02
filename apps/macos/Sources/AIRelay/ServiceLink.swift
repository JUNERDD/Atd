import AICore
import Foundation

/// Why no service endpoint is available.
public enum ServiceUnavailable: Error, Equatable, Sendable {
  /// Debug: nothing serves the development data directory. The shell never starts one; the
  /// developer runs `pnpm dev`.
  case developmentServiceNotRunning
  /// The data directory's files exist but are not a usable endpoint.
  case invalidEndpoint(ServiceEndpointError)
  /// Release: the supervisor is starting or restarting the service.
  case starting
  /// Release: the first start failed; the detail is what the service logged.
  case failed(String)
  /// Release: three unexpected exits within five minutes opened the circuit breaker; only a
  /// manual restart tries again.
  case stoppedTooOften
  /// Release: the supervisor was stopped (quit).
  case stopped
}

/// Where the relay, the virtual sockets and the control stream get the service from: the
/// Debug connect-only reader or the Release supervisor.
public protocol ServiceEndpointSource: AnyObject {
  /// The endpoint for a new request or connection.
  func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable>
  /// Set by ``ServiceLink``. A source calls it when its endpoint may have changed on its own
  /// (a supervised restart), so the link resolves again and tells its observers.
  var endpointMayHaveChanged: (@MainActor () -> Void)? { get set }
}

/// Reads the endpoint and token of a data directory (`discoverService` in `endpoint.ts`).
public enum ServiceDiscovery {
  public static func read(dataDirectory: URL) -> Result<ServiceEndpoint, ServiceEndpointError> {
    let endpointURL = dataDirectory.appending(path: ServiceEndpointFiles.endpointPath)
    let tokenURL = dataDirectory.appending(path: ServiceEndpointFiles.tokenPath)
    guard let endpointData = try? Data(contentsOf: endpointURL) else {
      return .failure(.notRunning)
    }
    guard let tokenData = try? Data(contentsOf: tokenURL) else {
      return .failure(.malformed(ServiceEndpointFiles.tokenPath))
    }
    do {
      let endpoint = try ServiceEndpointFiles.parse(
        endpoint: endpointData, token: tokenData, dataDirectory: dataDirectory)
      return isProcessAlive(endpoint.pid) ? .success(endpoint) : .failure(.stale)
    } catch {
      return .failure(error)
    }
  }
}

/// Debug: connects to the service `pnpm dev` runs for the development data directory, and never
/// starts, replaces or stops it (decision Q10). Every resolve reads `endpoint.json` again,
/// because the dev service's hot reload restarts it on a new port and epoch.
public final class DevelopmentServiceSource: ServiceEndpointSource {
  public let dataDirectory: URL
  public var endpointMayHaveChanged: (@MainActor () -> Void)?

  public init(dataDirectory: URL) {
    self.dataDirectory = dataDirectory
  }

  public func resolveEndpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    ServiceDiscovery.read(dataDirectory: dataDirectory).mapError { error in
      switch error {
      case .notRunning, .stale: .developmentServiceNotRunning
      default: .invalidEndpoint(error)
      }
    }
  }
}

/// The shell's single view of the service. Everything that talks to the service resolves the
/// endpoint here, and observers learn when the instance behind it changed (a restart or a new
/// port), which is when virtual sockets close with 1012 and the control stream reconnects.
public final class ServiceLink {
  public let source: any ServiceEndpointSource
  /// The latest resolve; nil before the first.
  public private(set) var latest: Result<ServiceEndpoint, ServiceUnavailable>?
  private var observers: [UUID: @MainActor (ServiceEndpoint?) -> Void] = [:]

  public init(source: any ServiceEndpointSource) {
    self.source = source
    source.endpointMayHaveChanged = { [weak self] in
      guard let self else { return }
      Task { _ = await self.endpoint() }
    }
  }

  /// The endpoint current now (Debug re-reads it from disk).
  public func endpoint() async -> Result<ServiceEndpoint, ServiceUnavailable> {
    let resolved = await source.resolveEndpoint()
    let previous = try? latest?.get()
    latest = resolved
    let current = try? resolved.get()
    let changed =
      switch (previous, current) {
      case (nil, _): false
      case (_?, nil): true
      case (let previous?, let current?): !previous.isSameInstance(as: current)
      }
    if changed { for observer in observers.values { observer(current) } }
    return resolved
  }

  /// Runs `observer` whenever a known instance is replaced or disappears, with the new endpoint
  /// (nil when none is available). Keep the returned token; releasing it removes the observer.
  public func observeChanges(
    _ observer: @escaping @MainActor (ServiceEndpoint?) -> Void
  ) -> ServiceLinkObservation {
    let id = UUID()
    observers[id] = observer
    return ServiceLinkObservation { [weak self] in self?.observers[id] = nil }
  }
}

/// Removes its observer when cancelled or released.
public final class ServiceLinkObservation {
  private var remove: (@MainActor () -> Void)?

  init(remove: @escaping @MainActor () -> Void) {
    self.remove = remove
  }

  public func cancel() {
    remove?()
    remove = nil
  }

  isolated deinit {
    remove?()
  }
}
