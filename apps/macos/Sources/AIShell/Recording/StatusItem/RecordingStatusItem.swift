import AICore
import AppKit

/// The recording's menu bar timer (architecture R1, R7): a status item of its own beside Atd's,
/// a red dot and the time recorded (``RecordingClock``, monospaced), the dot dimmed
/// while paused. A click opens its menu: Stop Recording (showing ⌃⌘Esc, the shell's stop key,
/// which the orchestrator holds), Pause or Resume, and Discard…, each reported through
/// ``onEvent`` as the island's controls are. It exists only while a recording runs:
/// ``show(elapsed:paused:)`` creates it, ``hide()`` removes it from the menu bar.
final class RecordingStatusItem: NSObject, NSMenuDelegate {
  /// A choice in its menu: ``IslandRecordingEvent/stop``, `pause`, `resume` or `discard`.
  var onEvent: ((IslandRecordingEvent) -> Void)?
  private var item: NSStatusItem?
  private var paused = false
  private var shownTime = ""
  private var languageObserver: NSObjectProtocol?

  /// Shows the timer at `elapsed` seconds, creating the item on the first call; later calls
  /// change only the time and the paused state, and only when they differ from what shows.
  func show(elapsed: Double, paused: Bool) {
    let created = item == nil
    let item = item ?? makeItem()
    let time = RecordingClock.text(elapsed)
    guard created || time != shownTime || paused != self.paused, let button = item.button
    else { return }
    if created || paused != self.paused { button.image = Self.dot(paused: paused) }
    shownTime = time
    self.paused = paused
    button.attributedTitle = NSAttributedString(
      string: " " + time, attributes: [.font: Self.font, .foregroundColor: NSColor.labelColor])
    retitle()
  }

  /// Removes the item from the menu bar; the next ``show(elapsed:paused:)`` creates it again.
  func hide() {
    guard let item else { return }
    NSStatusBar.system.removeStatusItem(item)
    self.item = nil
    shownTime = ""
    if let languageObserver { NotificationCenter.default.removeObserver(languageObserver) }
    languageObserver = nil
  }

  private func makeItem() -> NSStatusItem {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.imagePosition = .imageLeading
    let menu = NSMenu()
    menu.delegate = self
    menu.autoenablesItems = false
    item.menu = menu
    self.item = item
    languageObserver = NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.retitle() } }
    return item
  }

  /// The tooltip and VoiceOver name, in the shell language: recording or paused, with the time.
  private func retitle() {
    guard let button = item?.button, !shownTime.isEmpty else { return }
    let strings = ShellStrings.shared
    let tooltip = String(
      format: strings.text(paused ? .statusPaused : .statusRecording),
      locale: Locale(identifier: strings.language.rawValue), shownTime)
    button.toolTip = tooltip
    button.setAccessibilityLabel(tooltip)
  }

  // MARK: NSMenuDelegate

  /// The menu is built as it opens, so it reads the paused state and the language of now.
  func menuNeedsUpdate(_ menu: NSMenu) {
    let strings = ShellStrings.shared
    let stop = NSMenuItem(
      title: strings.text(.statusStop), action: #selector(stop), keyEquivalent: "\u{1b}")
    stop.keyEquivalentModifierMask = [.control, .command]
    let toggle = NSMenuItem(
      title: strings.text(paused ? .statusResume : .statusPause),
      action: #selector(togglePause), keyEquivalent: "")
    let discard = NSMenuItem(
      title: strings.text(.statusDiscard), action: #selector(discard), keyEquivalent: "")
    for item in [stop, toggle, discard] { item.target = self }
    menu.items = [stop, toggle, .separator(), discard]
  }

  @objc private func stop() { onEvent?(.stop) }
  @objc private func togglePause() { onEvent?(paused ? .resume : .pause) }
  @objc private func discard() { onEvent?(.discard) }

  // MARK: Drawing

  private static let font = NSFont.monospacedDigitSystemFont(
    ofSize: NSFont.systemFontSize, weight: .regular)

  /// The red dot, 8 pt in a 12 pt image so it sits on the title's baseline area; dimmed while
  /// paused. Not a template: the menu bar keeps its red.
  private static func dot(paused: Bool) -> NSImage {
    let image = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
      NSColor.systemRed.withAlphaComponent(paused ? 0.45 : 1).setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
      return true
    }
    image.isTemplate = false
    return image
  }

}
