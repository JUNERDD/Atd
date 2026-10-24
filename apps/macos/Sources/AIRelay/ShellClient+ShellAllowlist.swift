import AICore
import Foundation

extension ShellClient {
  /// The user list's limit (`SHELL_ALLOWLIST_MAX_ENTRIES` in `@atd/agent-contracts`).
  public static let shellAllowlistLimit = 100

  /// Adds one entry to the user's shell allowlist, as the panel's `addShellAllowlistEntry` does:
  /// `GET /v1/settings`, then `PATCH /v1/settings { shellAllowlist }` with the entry appended.
  /// An entry already listed changes nothing. The service validates the entry and persists the
  /// list, which reaches every client and the service's own shell policy.
  public func addShellAllowlistEntry(_ entry: String) async throws {
    let current = try JSONDecoder().decode(
      SettingsAllowlist.self, from: try await send("GET", "/v1/settings").data
    ).settings.shellAllowlist
    guard !current.contains(entry) else { return }
    guard current.count < Self.shellAllowlistLimit else {
      throw ShellClientError.invalidArgument("The shell allowlist is full.")
    }
    let body = try JSONEncoder().encode(["shellAllowlist": current + [entry]])
    _ = try await send("PATCH", "/v1/settings", body: body, contentType: "application/json")
  }

  /// The only part of `SettingsResponseSchema` this call reads.
  private struct SettingsAllowlist: Decodable {
    struct Settings: Decodable {
      let shellAllowlist: [String]
    }
    let settings: Settings
  }
}
