import AICore
import CryptoKit
import Darwin
import Foundation
import OSLog
import Security

/// The Chrome profiles the person paired with this build (D4), in
/// `~/Library/Application Support/<bundleId>/chrome/pairings.json` (owner-only, 0600). A pairing is
/// keyed by the extension's installation id and holds only the SHA-256 of its secret: the secret
/// itself (32 random bytes, base64url) leaves the shell once, in the `pair.state` that confirms the
/// pairing, and the extension presents it in every later `hello`.
final class ChromePairingStore {
  enum VerifyResult: Equatable {
    case valid
    case browserMismatch
    case invalid
  }

  struct Pairing: Codable, Equatable {
    var label: String
    var email: String?
    /// The browser the pairing was made from (`Google Chrome`, `Aside`, …).
    var browser: String
    /// The verified browser's signing identifier (TOFU binding; nil on legacy v1 records).
    var browserSigningIdentifier: String?
    /// The verified browser's Developer ID team identifier (TOFU binding; nil on legacy v1 records).
    var browserTeamId: String?
    var createdAt: String
    var lastSeenAt: String
    /// Lowercase hex SHA-256 of the secret's UTF-8 bytes.
    var secretHash: String
  }

  private struct File: Codable {
    var version = 1
    var pairings: [String: Pairing] = [:]
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome")
  private let url: URL
  private var file = File()
  /// The pairings file could not be read, at this launch or an earlier one, and the person has
  /// not resolved it yet (``resolve()``: a new pairing, or a disconnect in Settings). The file is
  /// left in place and copied aside once, and a marker beside it keeps this state across
  /// launches, so a later launch never reads the loss as an empty store. Meanwhile the shell
  /// treats every pairing it cannot confirm as unknown rather than revoked: it neither deletes site
  /// bindings for lack of a pairing nor tells an extension to forget its secret.
  private(set) var unreadable = false

  /// Reads the store at `url`. A missing file is an empty store; one that cannot be read or
  /// decoded leaves the store ``unreadable``, as does the marker an earlier launch left.
  init(url: URL) {
    self.url = url
    let files = FileManager.default
    unreadable = files.fileExists(atPath: marker.path(percentEncoded: false))
    guard files.fileExists(atPath: url.path(percentEncoded: false)) else { return }
    do {
      // With the marker, these are only the pairings made since the file became unreadable.
      file = try JSONDecoder().decode(File.self, from: Data(contentsOf: url))
    } catch {
      Self.log.error("The Chrome pairings could not be read: \(error, privacy: .public)")
      guard !unreadable else { return }
      unreadable = true
      let stamp = Int(Date().timeIntervalSince1970)
      let aside = url.deletingLastPathComponent()
        .appending(path: "\(url.lastPathComponent).corrupt-\(stamp)")
      let copied = (try? files.copyItem(at: url, to: aside)) != nil
      let marked = files.createFile(
        atPath: marker.path(percentEncoded: false), contents: Data(),
        attributes: [.posixPermissions: 0o600])
      Self.log.error("Kept the unreadable pairings (copied: \(copied), marked: \(marked)).")
    }
  }

  /// The person paired a profile again or disconnected one: the pairings this store holds are
  /// the ones there are, and profiles it does not know are unpaired from now on.
  func resolve() {
    guard unreadable else { return }
    unreadable = false
    unlink(marker.path(percentEncoded: false))
    Self.log.info("The unreadable Chrome pairings were resolved.")
  }

  private var marker: URL {
    url.deletingLastPathComponent().appending(path: "\(url.lastPathComponent).unreadable")
  }

  var pairings: [String: Pairing] { file.pairings }

  func pairing(_ installationId: String) -> Pairing? { file.pairings[installationId] }

  /// Whether `secret` matches `installationId` (constant time) and `browserIdentity` matches its
  /// TOFU binding (or the pairing predates TOFU and has neither field set).
  func verify(
    _ installationId: String, secret: String, browserIdentity: ChromeBrowserIdentity
  ) -> VerifyResult {
    guard let pairing = file.pairings[installationId] else { return .invalid }
    let presented = Self.hash(secret)
    let stored = pairing.secretHash
    guard presented.utf8.count == stored.utf8.count,
      zip(presented.utf8, stored.utf8).reduce(0, { $0 | ($1.0 ^ $1.1) }) == 0
    else { return .invalid }
    if pairing.browserSigningIdentifier == nil, pairing.browserTeamId == nil {
      return .valid
    }
    if pairing.browserSigningIdentifier == browserIdentity.signingIdentifier,
      pairing.browserTeamId == browserIdentity.teamId
    {
      return .valid
    }
    return .browserMismatch
  }

  /// Pairs `installationId` (replacing an earlier pairing of it) and returns the new secret.
  func pair(
    _ installationId: String, label: String, email: String?, browser: String,
    browserIdentity: ChromeBrowserIdentity
  ) throws -> String {
    let secret = try Self.newSecret()
    let now = ComputerWireCoding.timestamp(Date())
    file.pairings[installationId] = Pairing(
      label: label, email: email, browser: browser,
      browserSigningIdentifier: browserIdentity.signingIdentifier,
      browserTeamId: browserIdentity.teamId,
      createdAt: now, lastSeenAt: now, secretHash: Self.hash(secret))
    try save()
    return secret
  }

  /// Records that `installationId` connected now, with its current label and browser. Backfills
  /// TOFU fields once on legacy pairings that have neither set; never overwrites existing ones.
  func seen(
    _ installationId: String, label: String, email: String?, browser: String,
    browserIdentity: ChromeBrowserIdentity?
  ) {
    guard var pairing = file.pairings[installationId] else { return }
    pairing.label = label
    pairing.email = email
    pairing.browser = browser
    if let browserIdentity,
      pairing.browserSigningIdentifier == nil,
      pairing.browserTeamId == nil
    {
      pairing.browserSigningIdentifier = browserIdentity.signingIdentifier
      pairing.browserTeamId = browserIdentity.teamId
    }
    pairing.lastSeenAt = ComputerWireCoding.timestamp(Date())
    file.pairings[installationId] = pairing
    try? save()
  }

  func remove(_ installationId: String) {
    guard file.pairings.removeValue(forKey: installationId) != nil else { return }
    do {
      try save()
    } catch {
      Self.log.error("The Chrome pairings could not be saved after a disconnect.")
    }
  }

  private func save() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
    let data = try encoder.encode(file)
    // Written owner-only into a sibling file, then renamed over the store, so the secrets' hashes
    // are never readable by others, not even for a moment.
    let path = url.path(percentEncoded: false)
    let staging = path + ".tmp"
    unlink(staging)
    guard
      FileManager.default.createFile(
        atPath: staging, contents: data, attributes: [.posixPermissions: 0o600]),
      rename(staging, path) == 0
    else {
      unlink(staging)
      throw CocoaError(.fileWriteUnknown)
    }
  }

  static func hash(_ secret: String) -> String {
    SHA256.hash(data: Data(secret.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  /// 32 random bytes as unpadded base64url.
  private static func newSecret() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw CocoaError(.featureUnsupported)
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
