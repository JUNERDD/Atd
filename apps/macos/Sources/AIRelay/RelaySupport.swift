import AICore
import Foundation
import os

/// Loopback sessions for everything the shell sends to the service and the Vite dev server.
enum RelaySession {
  /// No cookies, cache, credential storage or proxies; callbacks on the main queue, where the
  /// scheme tasks and web views they feed live, and in order.
  static let shared: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.urlCredentialStorage = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.connectionProxyDictionary = [:]
    configuration.waitsForConnectivity = false
    // Idle time between bytes, not a total: some service calls wait on a model or a tool.
    configuration.timeoutIntervalForRequest = 300
    return URLSession(configuration: configuration, delegate: nil, delegateQueue: .main)
  }()
}

enum RelayLog {
  static let relay = Logger(subsystem: "com.junerdd.ai", category: "relay")
  static let sockets = Logger(subsystem: "com.junerdd.ai", category: "sockets")
  static let control = Logger(subsystem: "com.junerdd.ai", category: "control")
  static let service = Logger(subsystem: "com.junerdd.ai", category: "service")
}

/// Callers waiting, with a bound, for a value another task produces (a route manifest, a
/// supervised service coming up). A waiter still waiting when its bound passes gets nil.
@MainActor
final class BoundedWaiters<Value: Sendable> {
  private var waiters: [UUID: CheckedContinuation<Value?, Never>] = [:]

  func wait(atMost limit: Duration) async -> Value? {
    let id = UUID()
    return await withCheckedContinuation { continuation in
      waiters[id] = continuation
      // Holds `self` until the bound passes, so no waiter is ever left unresumed.
      Task { @MainActor in
        try? await Task.sleep(for: limit)
        self.waiters.removeValue(forKey: id)?.resume(returning: nil)
      }
    }
  }

  func resumeAll(with value: Value?) {
    let resumed = waiters
    waiters = [:]
    for continuation in resumed.values { continuation.resume(returning: value) }
  }
}

extension HTTPURLResponse {
  /// Header fields as strings, as Foundation already joined repeated fields.
  var stringHeaders: [String: String] {
    var headers: [String: String] = [:]
    for (key, value) in allHeaderFields {
      if let key = key as? String, let value = value as? String { headers[key] = value }
    }
    return headers
  }
}

/// Liveness of a recorded pid: `kill(pid, 0)` succeeds, or fails only for lack of permission.
func isProcessAlive(_ pid: Int32) -> Bool {
  guard pid > 0 else { return false }
  return kill(pid, 0) == 0 || errno == EPERM
}

extension ServiceEndpoint {
  /// `baseURL` plus an already percent-encoded path and raw query. Built from the string, so a
  /// query with a malformed escape yields nil instead of a URLComponents trap.
  func url(encodedPath: String, query: String? = nil) -> URL? {
    URL(string: baseURL.absoluteString + encodedPath + (query.map { "?\($0)" } ?? ""))
  }
}
