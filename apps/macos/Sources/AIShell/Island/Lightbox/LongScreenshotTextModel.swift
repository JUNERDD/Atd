import AICore
import AppKit
import Observation

/// The long screenshot's recognized text as its full-screen preview works on it (the plan's
/// 「长截图的全屏预览」): the paragraphs (``LongScreenshotCardSource/paragraphs``, image points),
/// which of them can be picked now, the picks (``CaptureTextPicks``) and what the viewer marks on
/// them: the paragraph under the pointer, the marquee being dragged, the flash when text mode
/// opens, the paragraphs a command reads and the ones whose result just landed.
///
/// A paragraph is available while the kept range keeps all of it and no mosaic touches it
/// (``LongScreenshotKept/available(in:)``, decision D6); the lightbox calls ``refresh(kept:)`` on
/// every change of the card's state, and a pick that stopped being available goes. The viewer's
/// AppKit marks follow ``onChange``; the SwiftUI chrome observes the model.
@Observable
final class LongScreenshotTextModel {
  /// The paragraphs, in reading order; an index stays valid for the lightbox's life.
  @ObservationIgnored let layout: CaptureTextLayout
  /// The paragraphs that can be picked, copied and read now, in reading order.
  private(set) var available: [Int] = []
  private(set) var picks = CaptureTextPicks()
  /// The available paragraph under the pointer in text mode.
  private(set) var hovered: Int?
  /// The marquee being dragged (image points); nil otherwise.
  private(set) var marquee: CGRect?
  /// Text mode just opened: every available paragraph shows for a moment.
  private(set) var flashing = false
  /// The paragraphs the running command reads (its reading shimmer).
  private(set) var reading: Set<Int> = []
  /// The paragraphs whose result just landed, or that a result card item just pointed at.
  private(set) var landed: Set<Int> = []
  /// The text row's Copy just copied this many paragraphs.
  private(set) var copied: Int?

  /// Something the viewer marks changed.
  @ObservationIgnored var onChange: () -> Void = {}
  @ObservationIgnored private var availableSet: Set<Int> = []
  /// The picks as the marquee's drag began, which it adds to or replaces.
  @ObservationIgnored private var marqueeBase: CaptureTextPicks?
  @ObservationIgnored private var flashTask: Task<Void, Never>?
  @ObservationIgnored private var landedTask: Task<Void, Never>?
  @ObservationIgnored private var copiedTask: Task<Void, Never>?

  /// How long text mode's opening flash and a landing's flash show.
  static let flashDuration: Duration = .milliseconds(700)

  init(layout: CaptureTextLayout, kept: LongScreenshotKept) {
    self.layout = layout
    refresh(kept: kept)
  }

  isolated deinit {
    flashTask?.cancel()
    landedTask?.cancel()
    copiedTask?.cancel()
  }

  // MARK: What can be picked

  /// The kept range or a mosaic changed: the available paragraphs follow, and picks no longer
  /// available go.
  func refresh(kept: LongScreenshotKept) {
    let next = kept.available(in: layout)
    guard next != available else { return }
    available = next
    availableSet = Set(next)
    let filtered = picks.filtered(availableSet)
    if filtered != picks { picks = filtered }
    if let hovered, !availableSet.contains(hovered) { self.hovered = nil }
    onChange()
  }

  /// The available paragraph at `point` (image points), if any.
  func paragraph(at point: CGPoint) -> Int? {
    layout.paragraph(at: point).flatMap { availableSet.contains($0) ? $0 : nil }
  }

  /// What a command reads and Copy copies now, in reading order: the picks, else every available
  /// paragraph.
  var readingOrder: [Int] { picks.reading(available: available) }

  /// The scope chip's data.
  var scope: CaptureTextScope { picks.scope(available: available) }

  /// The text Copy puts on the clipboard: the recognized text of ``readingOrder``, paragraphs
  /// apart by a blank line.
  var selectionText: String { layout.selection(readingOrder) }

  // MARK: Picking

  /// A click at `point` (image points) with `modifiers`: only that paragraph, ⌘ toggles it, ⇧
  /// extends from the anchor. A plain click off the text clears the picks. False when nothing
  /// changed.
  @discardableResult
  func click(at point: CGPoint, modifiers: NSEvent.ModifierFlags) -> Bool {
    let before = picks
    if let index = paragraph(at: point) {
      let click: CaptureTextPicks.Click =
        modifiers.contains(.shift) ? .extend : modifiers.contains(.command) ? .toggle : .only
      picks.click(index, click, in: layout, available: availableSet)
    } else if modifiers.isDisjoint(with: [.command, .shift]) {
      picks.clear()
    }
    guard picks != before else { return false }
    onChange()
    return true
  }

  /// ⌘A: every available paragraph.
  func selectAll() {
    picks.selectAll(availableSet)
    onChange()
  }

  /// The scope chip's ×, or Escape: no picks, so commands read all the text again. False when
  /// there were none.
  @discardableResult
  func clear() -> Bool {
    guard !picks.isEmpty else { return false }
    picks.clear()
    onChange()
    return true
  }

  func hover(_ index: Int?) {
    guard hovered != index else { return }
    hovered = index
    onChange()
  }

  // MARK: The marquee

  /// A marquee's drag began: the picks as they stand are its base.
  func beginMarquee() {
    marqueeBase = picks
  }

  /// The marquee now spans `rect` (image points): the paragraphs it touches are the picks, added
  /// to the base when `adding` (⌘ or ⇧ held).
  func updateMarquee(_ rect: CGRect, adding: Bool) {
    guard let base = marqueeBase else { return }
    marquee = rect
    picks = CaptureTextPicks.marquee(
      layout.paragraphs(touching: rect), over: base, adding: adding, available: availableSet)
    onChange()
  }

  /// The marquee was let go, keeping its picks, or Escape `cancel`led it back to its base.
  func endMarquee(cancel: Bool = false) {
    guard let base = marqueeBase else { return }
    if cancel { picks = base }
    marqueeBase = nil
    marquee = nil
    onChange()
  }

  var isDraggingMarquee: Bool { marqueeBase != nil }

  // MARK: Feedback

  /// Text mode opened: the available paragraphs flash once, so the person sees what can be picked.
  func flash() {
    flashing = true
    onChange()
    flashTask?.cancel()
    flashTask = Task { [weak self] in
      try? await Task.sleep(for: Self.flashDuration)
      guard !Task.isCancelled, let self else { return }
      flashing = false
      onChange()
    }
  }

  /// A command reads `indices` (its shimmer), or nothing reads.
  func setReading(_ indices: Set<Int>) {
    guard reading != indices else { return }
    reading = indices
    onChange()
  }

  /// A result landed on `indices`, or a card item points at them: they flash for a moment.
  func land(_ indices: Set<Int>) {
    guard !indices.isEmpty else { return }
    landed = indices
    onChange()
    landedTask?.cancel()
    landedTask = Task { [weak self] in
      try? await Task.sleep(for: Self.flashDuration)
      guard !Task.isCancelled, let self else { return }
      landed = []
      onChange()
    }
  }

  /// The text row's Copy copied `count` paragraphs: it says so for a moment.
  func confirmCopy(_ count: Int) {
    copied = count
    copiedTask?.cancel()
    copiedTask = Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard !Task.isCancelled else { return }
      self?.copied = nil
    }
  }
}
