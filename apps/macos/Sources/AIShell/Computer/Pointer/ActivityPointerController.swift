import AICore
import AppKit

/// The live operation pointer (plan §3.4): draws each task's current operation on its visible
/// target from the host's own progress, as ``PointerFramePolicy`` decides. The coordinator maps
/// progress to ``PointerFrame``s after its visibility checks; this only draws them.
///
/// Drawing is display only. One overlay per display holding a target (``PointerOverlay``) is
/// mouse-transparent and never key, main or active, and nothing here moves the system cursor,
/// activates an app or sends input, so the pointer never pauses a task or takes input from the
/// user. A mark goes as soon as its frame says so, its observation expires, or the displays
/// change; it is never left over a page that may have moved.
///
/// The monitor's pointer (``MonitorPointerFeed``) gets every frame too, because it also marks
/// windows that are covered or off screen, which the marks here never are.
final class ActivityPointerController {
  /// Whether marks draw (the user's setting), here and in the monitor. Turning it off removes
  /// every mark at once; frames that arrive meanwhile are dropped, and the next frame after it is
  /// back on draws.
  var isEnabled = true {
    didSet {
      monitor.isEnabled = isEnabled
      if !isEnabled { removeAll() }
    }
  }

  private struct Entry {
    var frame: PointerFrame
    /// When the mark goes: its observation expires, or its completion has been shown.
    var until: Date
    var completing: Bool
    var fading = false
    var feedback: Feedback?
    var isCurrent: () -> Bool
    let mark: PointerMark
  }

  private struct Feedback {
    let frame: PointerFrame
    let until: Date
  }

  /// Sequences kept per key beyond the marks on screen, so a late frame of a cleared mark stays
  /// dropped; past this many, those of keys without a mark are forgotten.
  private static let sequenceMemory = 256
  /// How long a capture waits after hiding the overlays, for the window server to drop them.
  private static let hideSettle = Duration.milliseconds(50)

  private var entries: [PointerKey: Entry] = [:]
  private var sequences: [PointerKey: Int] = [:]
  private var overlays: [CGDirectDisplayID: PointerOverlay] = [:]
  private var badgesShown = false
  /// Captures in progress that asked for the overlays to be hidden.
  private var captureHolds = 0
  private var sweep: Task<Void, Never>?
  private var observers: [NSObjectProtocol] = []
  private let monitor: MonitorPointerFeed

  init(monitor: MonitorPointerFeed = .shared) {
    self.monitor = monitor
    observe()
  }

  /// Applies the host's latest frame for its key: shows, moves, completes or clears its mark.
  /// `observation` is where the host observed the target whether or not it is visible; the
  /// monitor draws from it, and without one from the frame's own rect.
  func show(
    _ frame: PointerFrame, isCurrent: @escaping () -> Bool,
    observation: MonitorPointerObservation? = nil
  ) {
    monitor.apply(frame, observation: observation)
    let now = Date()
    let previous = entries[frame.key]?.feedback
    let sameTarget =
      previous?.frame.targetRect == frame.targetRect
      && previous?.frame.action == frame.action
    let decision = PointerFramePolicy.decide(
      frame, after: sequences[frame.key], now: now,
      feedbackUntil: sameTarget ? previous?.until : nil)
    if decision == .stale { return }
    sequences[frame.key] = frame.sequence
    forgetSequences()
    switch decision {
    case .stale: return
    case .clear: remove(frame.key)
    case .show(let until): draw(frame, until: until, completing: false, isCurrent: isCurrent)
    case .complete(let until): draw(frame, until: until, completing: true, isCurrent: isCurrent)
    case .settle(let until): settle(frame, until: until, isCurrent: isCurrent)
    }
    refreshBadges()
    reschedule()
  }

  /// Removes the key's mark now (stop, takeover, disconnect, target gone).
  func clear(_ key: PointerKey) {
    remove(key)
    monitor.remove(key)
    refreshBadges()
    reschedule()
  }

  /// Removes every mark now.
  func clearAll() {
    removeAll()
    monitor.removeAll()
  }

  /// Whether a mark is on screen on the display.
  func isShowing(on displayID: CGDirectDisplayID) -> Bool {
    overlays[displayID]?.isShowing ?? false
  }

  /// Runs `capture` with every overlay off screen, for a capture path that cannot leave Atd's
  /// windows out by itself, so an agent never sees its own pointer as a control. Frames that
  /// arrive meanwhile are applied but stay hidden until the last such capture ends.
  func hideAll<T>(forCapture capture: () async throws -> T) async rethrows -> T {
    InsertionTraceOverlay.beginCapture()
    defer { InsertionTraceOverlay.endCapture() }
    captureHolds += 1
    let wasShowing = overlays.values.contains(where: \.isShowing)
    for overlay in overlays.values { overlay.hide() }
    if wasShowing { try? await Task.sleep(for: Self.hideSettle) }
    do {
      let result = try await capture()
      releaseCaptureHold()
      return result
    } catch {
      releaseCaptureHold()
      throw error
    }
  }

  // MARK: Marks

  private func draw(
    _ frame: PointerFrame, until: Date, completing: Bool, isCurrent: @escaping () -> Bool
  ) {
    guard isEnabled, isCurrent(), let rect = frame.targetRect else { return remove(frame.key) }
    let screens = NSScreen.screens
    let primaryHeight = screens.first?.frame.height ?? 0
    let displays = screens.map { CaptureCoordinates.flip($0.frame, primaryHeight: primaryHeight) }
    guard let index = PointerGeometry.display(for: rect, in: displays),
      let displayID = screens[index].displayID,
      let target = CaptureCoordinates.viewRect(rect, display: displays[index])
    else { return remove(frame.key) }
    let overlay = overlay(displayID, screen: screens[index], bounds: displays[index])
    let mark = entries[frame.key]?.mark ?? PointerMark()
    let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let glides =
      mark.displayID == displayID
      && PointerFramePolicy.glides(from: mark.target, to: target, reduceMotion: reduceMotion)
    let dispatched = frame.phase == .dispatching || frame.phase == .typingField
    let feedback =
      dispatched
      ? Feedback(
        frame: frame, until: min(until, .now.addingTimeInterval(PointerFramePolicy.feedbackHold)))
      : entries[frame.key]?.feedback
    entries[frame.key] = Entry(
      frame: frame, until: until, completing: completing, feedback: feedback,
      isCurrent: isCurrent, mark: mark)
    mark.place(
      target: target, on: overlay, appearance: appearance(frame), glide: glides,
      dispatched: dispatched && frame.action == .click)
    if captureHolds == 0 { overlay.show() }
    closeIdleOverlays()
  }

  /// Let a quick input remain perceptible, with neutral copy. This never replays its animation,
  /// extends the dispatch deadline, or makes an invisible/invalid target visible again.
  private func settle(_ frame: PointerFrame, until: Date, isCurrent: @escaping () -> Bool) {
    guard isEnabled, isCurrent(), var entry = entries[frame.key], let feedback = entry.feedback
    else { return remove(frame.key) }
    entry.frame = frame
    entry.until = until
    entry.completing = true
    entry.isCurrent = isCurrent
    entries[frame.key] = entry
    entry.mark.apply(appearance(frame, feedback: feedback.frame))
  }

  private func remove(_ key: PointerKey) {
    entries.removeValue(forKey: key)?.mark.remove()
    closeIdleOverlays()
  }

  private func removeAll() {
    for entry in entries.values { entry.mark.remove() }
    entries.removeAll()
    sweep?.cancel()
    sweep = nil
    badgesShown = false
    closeIdleOverlays()
  }

  /// Removes the marks whose time is up: an expired one at once, a completion with a fade (kept
  /// under Reduce Motion, which removes movement, not feedback).
  private func expire() {
    let now = Date()
    for (key, var entry) in entries {
      guard entry.frame.validUntil > now, entry.isCurrent() else {
        remove(key)
        continue
      }
      guard !entry.fading, entry.until <= now else { continue }
      if entry.completing {
        entry.fading = true
        entries[key] = entry
        let sequence = entry.frame.sequence
        entry.mark.fadeOut { [weak self] in
          guard self?.entries[key]?.frame.sequence == sequence else { return }
          self?.remove(key)
          self?.refreshBadges()
          self?.reschedule()
        }
      } else {
        remove(key)
      }
    }
    closeIdleOverlays()
    refreshBadges()
    reschedule()
  }

  /// Recheck window movement and occlusion while a mark is visible, including its short hold
  /// and fade. Expiry is a fallback, never permission to draw over a window that moved away.
  private func reschedule() {
    sweep?.cancel()
    guard !entries.isEmpty else {
      sweep = nil
      return
    }
    let next = min(
      entries.values.filter { !$0.fading }.map(\.until).min() ?? .distantFuture,
      .now.addingTimeInterval(0.1))
    sweep = Task { [weak self] in
      try? await Task.sleep(for: .seconds(max(0, next.timeIntervalSinceNow) + 0.01))
      guard !Task.isCancelled else { return }
      self?.expire()
    }
  }

  private func appearance(_ frame: PointerFrame, feedback: PointerFrame? = nil)
    -> PointerMark.Appearance
  {
    PointerMark.Appearance(
      frame: frame, feedback: feedback,
      badge: badgesShown && !frame.taskBadge.isEmpty ? frame.taskBadge : nil)
  }

  /// Badges show while marks of more than one task are on screen; a change restyles them all.
  private func refreshBadges() {
    let shown = PointerFramePolicy.showsBadges(entries.keys)
    guard shown != badgesShown else { return }
    badgesShown = shown
    restyle()
  }

  /// Applies the current language, accessibility settings and badges to every mark in place.
  private func restyle() {
    for entry in entries.values {
      entry.mark.apply(appearance(entry.frame, feedback: entry.feedback?.frame))
    }
    monitor.restyle()
  }

  private func forgetSequences() {
    guard sequences.count > Self.sequenceMemory else { return }
    sequences = sequences.filter { entries[$0.key] != nil }
  }

  // MARK: Overlays

  /// The display's overlay, made again when the display's geometry is not the one it was made
  /// for.
  private func overlay(_ displayID: CGDirectDisplayID, screen: NSScreen, bounds: CGRect)
    -> PointerOverlay
  {
    if let overlay = overlays[displayID], overlay.bounds == bounds,
      overlay.scale == screen.backingScaleFactor
    {
      return overlay
    }
    overlays[displayID]?.hide()
    let overlay = PointerOverlay(screen: screen, displayID: displayID, bounds: bounds)
    overlays[displayID] = overlay
    return overlay
  }

  private func closeIdleOverlays() {
    for (id, overlay) in overlays where overlay.isEmpty {
      overlay.hide()
      overlays.removeValue(forKey: id)
    }
  }

  private func releaseCaptureHold() {
    captureHolds -= 1
    guard captureHolds == 0 else { return }
    expire()
    for overlay in overlays.values where !overlay.isEmpty { overlay.show() }
  }

  /// Displays changing (added, removed, rearranged, rescaled) can move every target, and no
  /// frame says where to: all marks go until the host reports positions again. Language and
  /// accessibility changes restyle the marks in place.
  private func observe() {
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.removeAll() } },
      center.addObserver(forName: ShellStrings.didChange, object: nil, queue: .main) {
        [weak self] _ in MainActor.assumeIsolated { self?.restyle() }
      },
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.removeAll() } },
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
        queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.restyle() } },
    ]
  }
}
