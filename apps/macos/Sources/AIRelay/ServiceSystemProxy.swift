import CFNetwork
import Foundation

/// A launch-time snapshot for the bundled Node service, whose networking does not read macOS
/// proxy preferences. Read the effective settings rather than a proxy app's configuration.
enum ServiceSystemProxy {
  static let environmentKey = "AI_AGENT_SYSTEM_PROXY"

  static func environment(inheriting parent: [String: String]) -> [String: String] {
    var environment = parent
    environment[environmentKey] = nil
    guard
      let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue()
        as? [String: Any]
    else { return environment }
    guard let snapshot = snapshot(settings) else { return environment }
    do {
      environment[environmentKey] = String(
        decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
    } catch {
      RelayLog.service.error("Could not encode the system proxy settings for the service.")
    }
    return environment
  }

  struct Snapshot: Encodable {
    let http: String?
    let https: String?
    let exceptions: [String]
    let excludeSimpleHostnames: Bool
  }

  static func snapshot(_ settings: [String: Any]) -> Snapshot? {
    // PAC/WPAD needs per-URL resolution, so a static HTTP snapshot cannot represent it.
    if enabled(kCFNetworkProxiesProxyAutoConfigEnable, in: settings)
      || enabled(kCFNetworkProxiesProxyAutoDiscoveryEnable, in: settings)
    {
      RelayLog.service.warning(
        "The service does not inherit automatic proxy configuration (PAC/WPAD).")
      return nil
    }
    let http = endpoint(
      enabled: kCFNetworkProxiesHTTPEnable, host: kCFNetworkProxiesHTTPProxy,
      port: kCFNetworkProxiesHTTPPort, in: settings)
    let https = endpoint(
      enabled: kCFNetworkProxiesHTTPSEnable, host: kCFNetworkProxiesHTTPSProxy,
      port: kCFNetworkProxiesHTTPSPort, in: settings)
    guard http != nil || https != nil else {
      if enabled(kCFNetworkProxiesSOCKSEnable, in: settings) {
        RelayLog.service.warning(
          "The service needs an HTTP/HTTPS system proxy; SOCKS-only is unsupported.")
      }
      return nil
    }
    return Snapshot(
      http: http, https: https,
      exceptions: settings[kCFNetworkProxiesExceptionsList as String] as? [String] ?? [],
      excludeSimpleHostnames: enabled(kCFNetworkProxiesExcludeSimpleHostnames, in: settings))
  }

  private static func enabled(_ key: CFString, in settings: [String: Any]) -> Bool {
    (settings[key as String] as? NSNumber)?.boolValue == true
  }

  private static func endpoint(
    enabled key: CFString, host hostKey: CFString, port portKey: CFString,
    in settings: [String: Any]
  ) -> String? {
    guard enabled(key, in: settings) else { return nil }
    guard let host = settings[hostKey as String] as? String, !host.isEmpty,
      host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
      host.rangeOfCharacter(from: CharacterSet(charactersIn: "/@?#")) == nil,
      let port = (settings[portKey as String] as? NSNumber)?.intValue,
      (1...65535).contains(port)
    else {
      RelayLog.service.warning("An enabled system HTTP proxy has an invalid host or port.")
      return nil
    }
    var components = URLComponents()
    // "Secure Web Proxy" describes HTTPS destinations; the proxy itself speaks HTTP CONNECT.
    components.scheme = "http"
    components.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    components.port = port
    return components.url?.absoluteString
  }
}
