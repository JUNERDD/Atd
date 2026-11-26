import AICore
import Foundation

nonisolated extension ShellClient {
  /// Maximum wire payload accepted from `GET /v1/admin/diagnostics/snapshot` (`600 KiB`, `01` §8.1
  /// & `04` §1.2).
  public static let maxDiagnosticsSnapshotBytes = 614_400
  /// Maximum wire payload accepted from `POST /v1/diagnostics/run` (`256 KiB`, `04` §1.2).
  public static let maxDoctorRunResponseBytes = 262_144

  /// `GET /v1/admin/diagnostics/snapshot` (`SHELL_ROUTE`): fetches the allowlisted service
  /// diagnostics snapshot using the main Bearer token, enforcing the `<= 600 KiB` payload bound.
  @concurrent
  public func diagnosticsSnapshot(
    maxBytes: Int = 614_400,
    timeout: TimeInterval = 2.0
  ) async throws -> Data {
    guard maxBytes > 0 else {
      throw ShellClientError.invalidArgument("maxBytes must be positive.")
    }
    let response = try await send(
      "GET", "/v1/admin/diagnostics/snapshot", timeout: timeout)
    guard response.data.count <= maxBytes else {
      throw ShellClientError.invalidResponse
    }
    guard (try? JSONSerialization.jsonObject(with: response.data)) is [String: Any] else {
      throw ShellClientError.invalidResponse
    }
    return response.data
  }

  /// `POST /v1/diagnostics/run`: runs static service Doctor checks from the native exporter when
  /// building `doctor-report.json`, enforcing the `<= 256 KiB` response bound.
  @concurrent
  public func runDiagnostics(
    includeConnectivity: Bool = false,
    maxBytes: Int = 262_144,
    timeout: TimeInterval = 3.0
  ) async throws -> Data {
    guard maxBytes > 0 else {
      throw ShellClientError.invalidArgument("maxBytes must be positive.")
    }
    let body = try JSONEncoder().encode(["includeConnectivity": includeConnectivity])
    let response = try await send(
      "POST", "/v1/diagnostics/run", body: body, contentType: "application/json", timeout: timeout)
    guard response.data.count <= maxBytes else {
      throw ShellClientError.invalidResponse
    }
    guard (try? JSONSerialization.jsonObject(with: response.data)) is [String: Any] else {
      throw ShellClientError.invalidResponse
    }
    return response.data
  }

  /// Probes whether the Vite development server at `origin` is serving the renderer entry page
  /// within `timeout`, bypassing system proxies via ``RelaySession/probe``.
  @concurrent
  public static func probeDevRenderer(
    _ origin: DevServerOrigin,
    timeout: TimeInterval = 0.35
  ) async -> Bool {
    guard let url = URL(string: origin.httpOrigin + "/") else { return false }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = max(0.05, timeout)
    request.setValue("text/html", forHTTPHeaderField: "Accept")
    guard let (data, response) = try? await RelaySession.probe.data(for: request),
      let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode),
      data.count <= maxDoctorRunResponseBytes
    else {
      return false
    }
    let html = String(decoding: data, as: UTF8.self)
    return html.contains("/@vite/client") && html.contains("/src/main.tsx")
  }
}
