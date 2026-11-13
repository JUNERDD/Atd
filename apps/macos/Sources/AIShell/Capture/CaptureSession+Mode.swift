import AICore
import AppKit

/// What a capture session offers besides picking and annotating an area (architecture C1, S1,
/// S8, R1). The default is a plain screenshot: what a screenshot command's own capture, the
/// Island's attach and an edit get.
struct CaptureSessionOptions {
  /// The mode the session opens in.
  var mode = CaptureMode.screenshot
  /// The currently registered screenshot shortcut, drawn beside the quick-copy action.
  var copyShortcut: String?
  /// Whether the bottom bar offers the 截图 | 录屏 pair. Off for a caller that needs an image.
  var canRecord = false
  /// The screenshot toolbar's command row (S1); nil shows none (S8).
  var commands: CaptureCommandRowSetup?
  /// Builds the record bar for a record-mode selection; nil shows none, and Return starts.
  var makeRecordAccessory: (@MainActor () -> any CaptureRecordAccessory)?
  /// Whether a screenshot selection can become a long screenshot (decision D5): only for a
  /// toolbar request, whose result goes to the island's card rather than back to a caller.
  var offersLongScreenshot = false
  /// Whether confirming a live long screenshot copies directly to the clipboard instead of
  /// opening the result card.
  var copiesLongScreenshotOnConfirm = false
}

/// The session's two modes on one selection (architecture C1): ⌘1 / ⌘2 or the bottom bar's
/// pair switch at any time but mid-drag. Switching keeps the selection; leaving screenshot mode
/// keeps its annotations, open text committed, which come back with the editor when the session
/// returns to it. Switching preserves the targeting scope and candidate under the pointer.
/// Record mode hosts the record bar (``CaptureRecordAccessory``) where the annotation toolbar
/// would be, placed by the same
/// rule, and Start ends the session with the region to record.
extension CaptureSession {
  func setMode(_ next: CaptureMode) {
    guard options.canRecord, next != mode else { return }
    switch phase {
    case .idle:
      mode = next
      refreshBars()
      renderIdle()
      requestHover()
    case .selected(let rect):
      if mode == .screenshot { keepAnnotations(of: rect) }
      unhost()
      mode = next
      refreshBars()
      host(rect)
    case .pressing, .creating, .adjusting, .longScreenshot:
      return
    }
  }

  /// Keeps the editor's annotations on `rect`, open text committed, in ``shotDocument`` (desktop
  /// points) for ``host(_:)`` to put back: before record mode or the long screenshot shows.
  func keepAnnotations(of rect: CGRect) {
    guard let editor else { return }
    editor.endText()
    let document = editor.document
    if !document.isEmpty {
      shotDocument = document.translated(by: CGVector(dx: rect.minX, dy: rect.minY))
    }
  }

  /// Puts the mode's work on the committed selection `rect`: the annotation editor, with the
  /// screenshot's annotations if record mode kept them, or the record bar.
  func host(_ rect: CGRect) {
    for overlay in overlays {
      overlay.annotationHost.passThrough = { [weak self] in self?.ownsPress(at: $0) ?? false }
    }
    switch mode {
    case .screenshot: hostEditor(rect)
    case .record: hostAccessory(rect)
    }
  }

  /// Takes the editor or the record bar off the selection; the session owns the overlays' input
  /// again, the keyboard included: the canvases that had it are gone.
  func unhost() {
    editor?.hide()
    editor = nil
    accessory?.hide()
    accessory = nil
    interiorClaimed = false
    reader.cancel()
    for overlay in overlays {
      overlay.annotationHost.passThrough = nil
      overlay.annotationHost.scroll = nil
      overlay.window?.makeFirstResponder(overlay)
      overlay.refreshCursor()
    }
  }

  private func hostEditor(_ rect: CGRect) {
    let editor = makeEditor()
    self.editor = editor
    editor.onConfirm = { [weak self] in self?.confirm() }
    editor.onCancel = { [weak self] in self?.cancel() }
    editor.onCopy = { [weak self] in self?.copy() }
    editor.onLaunch = { [weak self] in self?.launch($0) }
    editor.onInteriorClaimChange = { [weak self] claimed in
      guard let self else { return }
      interiorClaimed = claimed
      for overlay in overlays { overlay.refreshCursor() }
    }
    editor.elementTargets = { [weak self] point in
      await self?.elementTargets(at: point) ?? []
    }
    editor.commandRow = options.commands
    editor.longScreenshot = longScreenshotAvailability(for: rect)
    editor.onLongScreenshot = { [weak self] in self?.startLongScreenshot() }
    editor.renderSelection = { [weak self] in self?.shootSelection() }
    editor.onTextResult = { [weak self] in self?.finish(.textResult($0)) }
    editor.keepClear = keepClear(for: rect)
    for overlay in overlays {
      overlay.annotationHost.scroll = { [weak editor] in editor?.scroll($0) ?? false }
    }
    editor.show(in: overlays.map(\.annotationHost), selection: rect) { [weak self] in
      self?.desktop.backdrop(for: $0)
    }
    if let kept = shotDocument {
      shotDocument = nil
      editor.restore(kept.translated(by: CGVector(dx: -rect.minX, dy: -rect.minY)))
    }
    readText(in: rect)
    probeScrollArea(in: rect)
  }

  private func hostAccessory(_ rect: CGRect) {
    guard let make = options.makeRecordAccessory else { return }
    let accessory = make()
    accessory.onStart = { [weak self] in self?.startRecording() }
    accessory.onCancel = { [weak self] in self?.cancel() }
    self.accessory = accessory
    placeAccessory(beside: rect)
  }

  /// The record bar beside `rect` on the display holding most of it, placed like the annotation
  /// toolbar (``AnnotationToolbarLayout/frames(bar:beside:within:keepClear:holding:gap:margin:)``),
  /// holding its place while the mouse drags the selection.
  func placeAccessory(beside rect: CGRect) {
    guard let accessory, let owner = primaryOverlay(for: rect) else { return }
    let part = rect.intersection(owner.bounds)
    let placed = AnnotationToolbarLayout.frames(
      bar: accessory.size, beside: part.isNull ? rect : part, within: owner.bounds,
      keepClear: keepClear(for: rect), holding: isAdjusting ? accessoryAnchor : nil)
    accessoryAnchor = placed.anchor
    accessory.place(in: owner.annotationHost, frame: placed.toolbar)
  }

  /// The mouse is moving or resizing the committed selection.
  var isAdjusting: Bool {
    if case .adjusting = phase { true } else { false }
  }

  /// Start: the session ends with the part of the selection on the display holding most of it,
  /// in that display's points. The caller adds the window and the app it shows from its snapshot.
  func startRecording() {
    guard mode == .record, case .selected(let rect) = phase,
      let primary = desktop.geometry.primary(for: rect)
    else { return }
    let display = desktop.geometry.frame(of: primary)
    let part = rect.intersection(display)
    guard !part.isNull, part.width >= 1, part.height >= 1 else { return }
    finish(
      .record(
        CaptureRecordRequest(
          displayID: primary.id, displayFrame: primary.quartzFrame,
          rect: part.offsetBy(dx: -display.minX, dy: -display.minY), windowID: nil,
          appName: nil, bundleID: nil)))
  }

  /// Reads the text in `rect`'s frozen pixels for the editor (S5), replacing a reading still
  /// running, once the selection stayed put for `delay` (``CaptureTextReader``); the pixels are
  /// rendered only then. Record mode reads nothing.
  func readText(in rect: CGRect, after delay: Duration = .zero) {
    guard mode == .screenshot, editor != nil else { return reader.cancel() }
    reader.read(rect, after: delay) { [weak self] in
      guard let self else { return nil }
      return CaptureExport.render(selection: rect, desktop: desktop, editor: nil)?.raw
    }
  }
}
