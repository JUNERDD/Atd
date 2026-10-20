import AICore
import Foundation

extension ShellClient {
  /// `GET /v1/addons`: the active add-on installs, kept only inside the `addons` directory of
  /// `dataDirectory`, the service data directory this shell connects with (``AddonInstalls``).
  public func addonInstalls(dataDirectory: URL) async throws -> AddonInstalls {
    let response = try await send("GET", "/v1/addons", timeout: 15)
    return try AddonInstalls.decode(response.data, dataDirectory: dataDirectory)
  }
}
