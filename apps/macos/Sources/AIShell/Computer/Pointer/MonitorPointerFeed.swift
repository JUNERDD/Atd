import AICore
import AppKit

/// The agent pointer's marks as the monitor draws them (plan §4.4). ``ActivityPointerController``
/// hands over every frame it is given, and each monitor picture (``ComputerMonitorPointerOverlay``)
/// draws the mark of the one source it shows.
///
/// These are not the marks of the real screen. Those exist only while their target is visible and
/// uncovered, but the monitor is for the windows that are not, so the feed keeps the host's own
/// observation (``MonitorPointerObservation``) and pins it to the window's frame at that moment. A
/// frame sent without one falls back to the rect the real-screen pointer got, which covers the
/// visible case only. The lifecycle is the real pointer's (``PointerFramePolicy``): a mark stays
/// until its observation expires, shows a verified completion and fades, and goes when the step
/// fails or clears, when its window moves or resizes, or when the user turns the live pointer off.
///
/// Where a mark lands on a picture is the picture's to decide, because that needs the frame it is
/// showing (``MonitorPointerMapping``).
final class MonitorPointerFeed {
  static let shared = MonitorPointerFeed()

  /// A mark as a picture draws it. A new `sequence` is a new observation, so the mark appears or
  /// moves; a change of `version` alone restyles it or starts its fade.
  struct Mark: Equatable {
    let key: PointerKey
    /// The window the target is in, whose frame `snapshot` pins.
    let windowId: Int
    var snapshot: MonitorPointerSnapshot
    var appearance: PointerMark.Appearance
    var sequence: Int
    var version: Int
    /// The observation is a sent click, which its picture marks with the ripple.
    var clicked: Bool
    var fading: Bool
  }

  /// What a source shows: the key whose marks belong on its picture and the window it streams.
  struct Link: Equatable {
    let key: PointerKey
    let windowId: Int
  }

  /// Whether marks are kept (the user's live pointer setting). Turning it off removes every mark
  /// at once; frames that arrive meanwhile are dropped.
  var isEnabled = true {
    didSet { if !isEnabled { removeAll() } }
  }

  private struct Entry {
    var mark: Mark
    /// The frame behind the mark, with the rect it was drawn for.
    var frame: PointerFrame
    /// When the mark goes: a completion has been shown, or its observation expires.
    var until: Date
    var completing: Bool
    var feedback: Feedback?
    var fadeStarted: Date?
  }

  private struct Feedback {
    let frame: PointerFrame
    let until: Date
  }

  private final class WeakLink {
    weak var source: ComputerMonitorSource?
    let link: Link

    init(_ source: ComputerMonitorSource, _ link: Link) {
      self.source = source
      self.link = link
    }
  }

  /// How often marks are checked against their windows while any is shown, as the real pointer's.
  private static let interval = Duration.milliseconds(100)
  /// Sequences kept per key beyond the marks shown, so a late frame of a cleared mark stays
  /// dropped; past this many, those of keys without a mark are forgotten.
  private static let sequenceMemory = 256

  private var entries: [PointerKey: Entry] = [:]
  private var sequences: [PointerKey: Int] = [:]
  /// The windows' frames as of the last check, which the pictures place marks against.
  private var live: [Int: CGRect] = [:]
  private var links: [ObjectIdentifier: WeakLink] = [:]
  private var observers: [ObjectIdentifier: () -> Void] = [:]
  private var sweeping: Task<Void, Never>?

  // MARK: Reading

  func mark(for key: PointerKey) -> Mark? { entries[key]?.mark }

  /// The window's frame as of the last check; nil when the window list had none.
  func liveFrame(of windowId: Int) -> CGRect? { live[windowId] }

  /// Runs `handler` on every change of any mark and on every check while marks are shown.
  func observe(_ owner: AnyObject, _ handler: @escaping () -> Void) {
    observers[ObjectIdentifier(owner)] = handler
  }

  func stopObserving(_ owner: AnyObject) {
    observers[ObjectIdentifier(owner)] = nil
  }

  // MARK: Sources

  /// Tells the feed that `source` streams `windowId` for the operations of `key`. The feed keeps
  /// no hold on the source.
  func link(_ source: ComputerMonitorSource, key: PointerKey, windowId: Int) {
    links = links.filter { $0.value.source != nil }
    links[ObjectIdentifier(source)] = WeakLink(source, Link(key: key, windowId: windowId))
  }

  func link(for source: ComputerMonitorSource) -> Link? {
    guard let entry = links[ObjectIdentifier(source)], entry.source === source else { return nil }
    return entry.link
  }

  private func linkedWindow(of key: PointerKey) -> Int? {
    links.values.first { $0.source != nil && $0.link.key == key }?.link.windowId
  }

  // MARK: Frames

  /// Applies a frame of the controller: shows, moves, completes or clears the key's mark.
  func apply(_ frame: PointerFrame, observation: MonitorPointerObservation?) {
    guard isEnabled else { return }
    let key = frame.key
    guard let windowId = observation?.windowId ?? linkedWindow(of: key) else { return remove(key) }
    let rect = observation?.rect ?? frame.targetRect
    let seen = PointerFrame(
      key: key, taskBadge: "", phase: frame.phase, targetRect: rect, verified: frame.verified,
      validUntil: frame.validUntil, sequence: frame.sequence, action: frame.action)
    let held = entries[key]?.feedback
    let sameTarget = held?.frame.targetRect == rect && held?.frame.action == frame.action
    let decision = PointerFramePolicy.decide(
      seen, after: sequences[key], now: .now, feedbackUntil: sameTarget ? held?.until : nil)
    if decision == .stale { return }
    sequences[key] = frame.sequence
    forgetSequences()
    switch decision {
    case .stale: return
    case .clear: entries[key] = nil
    case .show(let until): draw(seen, windowId: windowId, until: until, completing: false)
    case .complete(let until): draw(seen, windowId: windowId, until: until, completing: true)
    case .settle(let until): settle(seen, until: until)
    }
    didChange()
  }

  /// Removes the key's mark now.
  func remove(_ key: PointerKey) {
    guard entries.removeValue(forKey: key) != nil else { return }
    didChange()
  }

  func removeAll() {
    guard !entries.isEmpty else { return }
    entries.removeAll()
    didChange()
  }

  /// Applies the current language and accessibility settings to every mark in place.
  func restyle() {
    for (key, var entry) in entries {
      entry.mark.appearance = PointerMark.Appearance(
        frame: entry.frame, feedback: entry.feedback?.frame, badge: nil)
      entry.mark.version += 1
      entries[key] = entry
    }
    didChange()
  }

  private func draw(_ frame: PointerFrame, windowId: Int, until: Date, completing: Bool) {
    guard let rect = frame.targetRect, let windowFrame = Self.windowFrame(of: windowId) else {
      entries[frame.key] = nil
      return
    }
    live[windowId] = windowFrame
    let sent = frame.phase == .dispatching || frame.phase == .typingField
    let feedback =
      sent
      ? Feedback(
        frame: frame, until: min(until, .now.addingTimeInterval(PointerFramePolicy.feedbackHold)))
      : entries[frame.key]?.feedback
    entries[frame.key] = Entry(
      mark: Mark(
        key: frame.key, windowId: windowId,
        snapshot: MonitorPointerSnapshot(
          rect: rect, windowFrame: windowFrame, validUntil: frame.validUntil),
        appearance: PointerMark.Appearance(frame: frame, badge: nil), sequence: frame.sequence,
        version: (entries[frame.key]?.mark.version ?? 0) + 1,
        clicked: frame.phase == .dispatching && frame.action == .click, fading: false),
      frame: frame, until: until, completing: completing, feedback: feedback)
  }

  /// Finishes the feedback of an input already shown, in place and without claiming it worked.
  private func settle(_ frame: PointerFrame, until: Date) {
    guard var entry = entries[frame.key], let feedback = entry.feedback else {
      entries[frame.key] = nil
      return
    }
    let pinned = entry.mark.snapshot
    entry.frame = frame
    entry.until = until
    entry.completing = true
    entry.mark.snapshot = MonitorPointerSnapshot(
      rect: pinned.rect, windowFrame: pinned.windowFrame, validUntil: frame.validUntil)
    entry.mark.appearance = PointerMark.Appearance(
      frame: frame, feedback: feedback.frame, badge: nil)
    entry.mark.version += 1
    entries[frame.key] = entry
  }

  private func forgetSequences() {
    guard sequences.count > Self.sequenceMemory else { return }
    sequences = sequences.filter { entries[$0.key] != nil }
  }

  // MARK: Checks

  /// Checks every mark against its window as it is now: an expired one, or one whose window moved,
  /// resized or went, is removed at once; a completion starts its fade when its time is up and is
  /// removed when the fade is over. Pictures are told after every check, because the frame they
  /// show can change without any mark doing so.
  private func sweep() {
    let now = Date.now
    live = [:]
    for id in Set(entries.values.map(\.mark.windowId)) { live[id] = Self.windowFrame(of: id) }
    for key in Array(entries.keys) {
      guard var entry = entries[key] else { continue }
      let current =
        MonitorPointerMapping.staleness(
          of: entry.mark.snapshot, liveWindowFrame: live[entry.mark.windowId], now: now) == nil
      if !current {
        entries[key] = nil
      } else if let started = entry.fadeStarted {
        if now.timeIntervalSince(started) >= PointerStyle.fadeDuration + 0.05 {
          entries[key] = nil
        }
      } else if entry.completing, entry.until <= now {
        entry.fadeStarted = now
        entry.mark.fading = true
        entry.mark.version += 1
        entries[key] = entry
      }
    }
    didChange()
  }

  private func didChange() {
    if entries.isEmpty {
      sweeping?.cancel()
      sweeping = nil
    } else if sweeping == nil {
      sweeping = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: Self.interval)
          guard !Task.isCancelled, let self else { return }
          self.sweep()
        }
      }
    }
    for handler in Array(observers.values) { handler() }
  }

  /// The window's frame in Quartz global points; nil when the window list has none.
  static func windowFrame(of windowId: Int) -> CGRect? {
    guard let id = CGWindowID(exactly: windowId),
      let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]],
      let window = windows.first(where: { ($0[kCGWindowNumber as String] as? Int) == windowId }),
      let bounds = window[kCGWindowBounds as String] as? NSDictionary
    else { return nil }
    return CGRect(dictionaryRepresentation: bounds as CFDictionary)
  }
}
