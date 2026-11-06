import AICore
import Foundation

/// Remembers the installed release's header prompt across launches. An unknown installation
/// gets one prompt; afterwards only a higher stable marketing version creates another one.
/// Sparkle's download and quit callbacks never change this record: only a new running bundle
/// proves that the installed version changed.
final class ReleaseNotesReminder {
  var onChange: (() -> Void)?
  private let defaults: UserDefaults
  private let installedVersion: StableVersion?
  private var record: Record?
  private var panelVisible = false

  private static let key = "update.releaseNotes"
  private static let lifetime: TimeInterval = 24 * 60 * 60

  init(defaults: UserDefaults) {
    self.defaults = defaults
    let bundleVersion =
      (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
      as? String).flatMap(StableVersion.init)
    installedVersion = bundleVersion
    guard let installedVersion else { return }
    if let data = defaults.data(forKey: Self.key),
      let stored = try? JSONDecoder().decode(Record.self, from: data),
      StableVersion(stored.highestVersion) != nil
    {
      record = stored
    }
    let highest = record.flatMap { StableVersion($0.highestVersion) }
    if highest.map({ installedVersion.isNewer(than: $0) }) ?? true {
      record = Record(highestVersion: installedVersion.value, pending: true)
      save()
    }
    // A new launch is also a new viewing session. Later expiry waits for an actual opening.
    expire(at: Date())
  }

  var state: UpdateReleaseNotesEvent {
    let version = record.flatMap { record in
      record.pending && record.highestVersion == installedVersion?.value
        ? record.highestVersion : nil
    }
    return UpdateReleaseNotesEvent(version: version)
  }

  /// `show()` can be called again while visible; only a hidden-to-visible edge expires notes.
  func panelVisibilityChanged(_ visible: Bool) {
    guard visible != panelVisible else { return }
    panelVisible = visible
    if visible { expire(at: Date()) }
  }

  /// The renderer acknowledges the visible header, after window visibility and update priority
  /// have been applied. Repeated renders never extend its lifetime.
  func shown(version: String) {
    guard state.version == version, var record, record.firstShownAt == nil else { return }
    record.firstShownAt = Date()
    self.record = record
    save()
  }

  /// The header's link or close control, and About's release-notes link, dismiss this version.
  func dismiss(version: String) {
    guard state.version == version, var record else { return }
    record.pending = false
    self.record = record
    save()
    onChange?()
  }

  private func expire(at now: Date) {
    guard state.version != nil, var record, let firstShownAt = record.firstShownAt,
      now.timeIntervalSince(firstShownAt) >= Self.lifetime
    else { return }
    record.pending = false
    self.record = record
    save()
    onChange?()
  }

  private func save() {
    guard installedVersion != nil, let record, let data = try? JSONEncoder().encode(record)
    else { return }
    defaults.set(data, forKey: Self.key)
  }

  /// Keeping the highest version after dismissal prevents a downgrade or reinstall from
  /// manufacturing a new prompt for a release already observed.
  private struct Record: Codable {
    let highestVersion: String
    var pending: Bool
    var firstShownAt: Date?
  }

  /// Stable releases use canonical x.y.z. Compare decimal components without fixed-width
  /// integer conversion; prerelease and build metadata never become release-note targets.
  private struct StableVersion {
    let value: String
    let components: [Substring]

    init?(_ value: String) {
      let components = value.split(separator: ".", omittingEmptySubsequences: false)
      guard value.utf8.count <= 64, components.count == 3,
        components.allSatisfy({ component in
          !component.isEmpty && component.utf8.allSatisfy { (48...57).contains($0) }
            && (component == "0" || component.first != "0")
        })
      else { return nil }
      self.value = value
      self.components = components
    }

    func isNewer(than other: Self) -> Bool {
      for (current, previous) in zip(components, other.components) {
        if current.count != previous.count { return current.count > previous.count }
        if current != previous { return previous.lexicographicallyPrecedes(current) }
      }
      return false
    }
  }
}
