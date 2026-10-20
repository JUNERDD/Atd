import Foundation

/// Screen-capture consent the person prepared from Settings (plan §8.3): one record per Atd
/// bundle id, since macOS asks each app identity separately. Records live with the computer
/// host's other files, which every Atd build of the login session shares, one file per bundle id
/// (`capture-consent/<bundle id>.json`), so no build ever rewrites another's. Only the person's
/// Settings action writes one; an unattended operation that needs a direct screen capture runs
/// only while this app's record exists, and never prompts mid-run (plan I7).
public struct CaptureConsentRecord: Codable, Equatable, Sendable {
  public var bundleId: String
  /// When the person prepared it: ISO 8601 with fractional seconds, UTC.
  public var primedAt: String

  public init(bundleId: String, primedAt: Date) {
    self.bundleId = bundleId
    self.primedAt = HostJournalEntry.timestamp(primedAt)
  }

  public static let directoryName = "capture-consent"

  /// The record's file name for `bundleId`: the id with anything but letters, digits, dots,
  /// hyphens and underscores replaced, so no id can name a path outside the directory.
  public static func fileName(for bundleId: String) -> String {
    let safe = bundleId.unicodeScalars.map { scalar -> String in
      let allowed =
        scalar.isASCII
        && (CharacterSet.alphanumerics.contains(scalar) || "._-".unicodeScalars.contains(scalar))
      return allowed ? String(scalar) : "_"
    }
    return String(safe.joined().prefix(200)) + ".json"
  }

  /// The record `data` holds for `bundleId`; nil when it is absent, unreadable, names another app
  /// or carries no valid time, so a damaged file only means preparing again.
  public static func decoding(_ data: Data?, bundleId: String) -> CaptureConsentRecord? {
    guard let data, let record = try? JSONDecoder().decode(Self.self, from: data),
      record.bundleId == bundleId, BridgeCoding.parseDateTime(record.primedAt) != nil
    else { return nil }
    return record
  }
}
