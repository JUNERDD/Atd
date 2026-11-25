import Foundation
import Testing

@testable import AIShell

@MainActor
@Suite("ChromePairingStore TOFU binding and v1 compatibility")
struct ChromePairingStoreTests {
  private static let chrome = ChromeBrowserIdentity(
    signingIdentifier: "com.google.Chrome", teamId: "EQHXZ8M8AV",
    developerName: "Google LLC", bundlePath: "/Applications/Google Chrome.app")

  private static let aside = ChromeBrowserIdentity(
    signingIdentifier: "at.studio.AsideBrowser", teamId: "8CPD4K4TBB",
    developerName: "At Inc.", bundlePath: "/Applications/Aside.app")

  private static func makeTempDir() throws -> URL {
    let dir = FileManager.default.temporaryDirectory
      .appending(path: "atd-chrome-pairing-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  @Test("Legacy v1 pairings.json without TOFU fields decodes cleanly and backfills once on seen")
  func legacyDecodeAndBackfillOnSeen() throws {
    let dir = try Self.makeTempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appending(path: "pairings.json")

    let secret = "legacy-secret-token"
    let legacyJSON = """
      {
        "version": 1,
        "pairings": {
          "inst-legacy": {
            "label": "Personal",
            "email": "user@example.com",
            "browser": "Google Chrome",
            "createdAt": "2026-01-01T00:00:00Z",
            "lastSeenAt": "2026-01-01T00:00:00Z",
            "secretHash": "\(ChromePairingStore.hash(secret))"
          }
        }
      }
      """
    try Data(legacyJSON.utf8).write(to: url)

    let store = ChromePairingStore(url: url)
    #expect(!store.unreadable)
    let initial = try #require(store.pairing("inst-legacy"))
    #expect(initial.browserSigningIdentifier == nil)
    #expect(initial.browserTeamId == nil)
    #expect(store.verify("inst-legacy", secret: secret, browserIdentity: Self.chrome) == .valid)

    // First seen backfills TOFU fields and persists them to disk.
    store.seen(
      "inst-legacy", label: "Personal", email: "user@example.com", browser: "Google Chrome",
      browserIdentity: Self.chrome)

    let reloaded = ChromePairingStore(url: url)
    let backfilled = try #require(reloaded.pairing("inst-legacy"))
    #expect(backfilled.browserSigningIdentifier == Self.chrome.signingIdentifier)
    #expect(backfilled.browserTeamId == Self.chrome.teamId)

    // Subsequent seen never overwrites existing non-nil TOFU fields.
    reloaded.seen(
      "inst-legacy", label: "Personal", email: "user@example.com", browser: "Aside",
      browserIdentity: Self.aside)
    let unchanged = try #require(reloaded.pairing("inst-legacy"))
    #expect(unchanged.browserSigningIdentifier == Self.chrome.signingIdentifier)
    #expect(unchanged.browserTeamId == Self.chrome.teamId)
  }

  @Test("Paired browser matches validly, rejects mismatch without deleting, and rejects bad secret")
  func verifyValidMismatchAndInvalid() throws {
    let dir = try Self.makeTempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appending(path: "pairings.json")

    let store = ChromePairingStore(url: url)
    let secret = try store.pair(
      "inst-aside", label: "Work", email: nil, browser: "Aside", browserIdentity: Self.aside)

    #expect(store.verify("inst-aside", secret: secret, browserIdentity: Self.aside) == .valid)

    // Different browser identity with valid secret returns browserMismatch without deleting.
    #expect(
      store.verify("inst-aside", secret: secret, browserIdentity: Self.chrome) == .browserMismatch)

    // Same signing identifier but different team ID also returns browserMismatch.
    let impostor = ChromeBrowserIdentity(
      signingIdentifier: Self.aside.signingIdentifier, teamId: "FAKE000001",
      developerName: "Impostor", bundlePath: "/Applications/Aside.app")
    #expect(
      store.verify("inst-aside", secret: secret, browserIdentity: impostor) == .browserMismatch)

    // Pairing stays intact in memory and on disk.
    let reloaded = ChromePairingStore(url: url)
    #expect(reloaded.verify("inst-aside", secret: secret, browserIdentity: Self.aside) == .valid)

    // Wrong secret or unknown id returns invalid (even when browser identity also differs).
    #expect(store.verify("inst-aside", secret: "wrong", browserIdentity: Self.aside) == .invalid)
    #expect(store.verify("inst-aside", secret: "wrong", browserIdentity: Self.chrome) == .invalid)
    #expect(store.verify("unknown-id", secret: secret, browserIdentity: Self.aside) == .invalid)
  }

  @Test("Corrupt pairings.json marks store unreadable with backup and clears on resolve")
  func unreadableHandlingAndResolve() throws {
    let dir = try Self.makeTempDir()
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appending(path: "pairings.json")
    try Data("{not valid json".utf8).write(to: url)

    let store = ChromePairingStore(url: url)
    #expect(store.unreadable)
    #expect(store.pairings.isEmpty)

    let entries = try FileManager.default.contentsOfDirectory(
      atPath: dir.path(percentEncoded: false))
    #expect(entries.contains("pairings.json.unreadable"))
    #expect(entries.contains { $0.hasPrefix("pairings.json.corrupt-") })

    // Re-opening preserves unreadable state via marker.
    let reopened = ChromePairingStore(url: url)
    #expect(reopened.unreadable)

    reopened.resolve()
    #expect(!reopened.unreadable)
    #expect(
      !FileManager.default.fileExists(
        atPath: dir.appending(path: "pairings.json.unreadable").path(percentEncoded: false)))
  }
}
