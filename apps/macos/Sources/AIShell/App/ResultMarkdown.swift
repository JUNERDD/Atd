import Foundation
import Observation

/// The user's Markdown in results setting in the shell: whether the floating result cards (the
/// command island's answer and review cards, and the capture, recording and long screenshot
/// results) render their text as Markdown or show it plain. The panel page pushes it
/// (`resultMarkdown.set`) after settings load and on every change; it is kept in the user
/// defaults, so a launch shows the last choice before that first push, and reads as on until the
/// user ever turns it off.
///
/// SwiftUI cards read ``enabled`` through observation; AppKit consumers follow ``didChange``,
/// which each change posts.
@Observable
final class ResultMarkdown {
  static let shared = ResultMarkdown()
  static let didChange = Notification.Name("ResultMarkdown.didChange")

  private(set) var enabled: Bool

  @ObservationIgnored private let defaults: UserDefaults

  /// The defaults key of the last pushed setting; absent until the first push.
  private static let key = "resultMarkdown"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    enabled = defaults.object(forKey: Self.key) as? Bool ?? true
  }

  func apply(_ enabled: Bool) {
    defaults.set(enabled, forKey: Self.key)
    guard enabled != self.enabled else { return }
    self.enabled = enabled
    NotificationCenter.default.post(name: Self.didChange, object: self)
  }
}
