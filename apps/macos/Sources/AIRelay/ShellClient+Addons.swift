import AICore
import Foundation

extension ShellClient {
  /// A bounded, metadata-only read for one toolbar gesture; never polls the WPS process.
  public func wpsSelection(since: TimeInterval) async throws -> WpsSelectionState {
    let milliseconds = Int64(floor(since * 1000))
    let response = try await send(
      "GET", "/v1/integrations/wps-selection?since=\(milliseconds)", timeout: 0.12)
    guard response.data.count <= 4096 else { throw ShellClientError.invalidResponse }
    let state = try JSONDecoder().decode(WpsSelectionState.self, from: response.data)
    if let event = state.event {
      guard event.windowTitle.utf16.count <= 512, event.occurredAt.isFinite else {
        throw ShellClientError.invalidResponse
      }
    }
    return state
  }

  /// `GET /v1/addons`: the active add-on installs, kept only inside the `addons` directory of
  /// `dataDirectory`, the service data directory this shell connects with (``AddonInstalls``).
  public func addonInstalls(dataDirectory: URL) async throws -> AddonInstalls {
    let response = try await send("GET", "/v1/addons", timeout: 15)
    return try AddonInstalls.decode(response.data, dataDirectory: dataDirectory)
  }
}
