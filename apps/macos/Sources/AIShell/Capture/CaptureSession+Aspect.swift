import AICore
import AppKit

/// Aspect-ratio preset menu, Space-pan selection drags, loupe color copy, and desktop Pin action.
extension CaptureSession {
  func pin(trigger: FinishTrigger = .unknown) { end(trigger: trigger, as: Outcome.pinned) }

  func canClickBadge(on overlay: CaptureOverlayView) -> Bool {
    guard isActive, accessory?.isModal != true, !choosingSaveDestination,
      case .selected = phase
    else { return false }
    return editor?.allowsBadgeInteraction ?? true
  }

  func isInteractiveBadge(at desktopPoint: CGPoint) -> Bool {
    overlays.contains {
      $0.bounds.contains(desktopPoint) && $0.isInteractiveBadge(at: desktopPoint)
    }
  }

  func showAspectMenu(on overlay: CaptureOverlayView, with event: NSEvent) {
    guard canClickBadge(on: overlay) else { return }
    for overlay in overlays { overlay.dismissCornerPopover() }
    let strings = ShellStrings.shared
    let menu = NSMenu()
    let freeLabel = strings.text(CaptureToolsStringKey.aspectFree)
    let handler = CaptureAspectMenuTarget(
      onPickAspect: { [weak self] preset in self?.applyAspectPreset(preset) },
      onPickCorner: { [weak self] radius in self?.applyCaptureCornerRadius(radius) })
    aspectMenuTarget = handler
    for preset in SelectionAspectPreset.allCases {
      let item = NSMenuItem(
        title: preset.label(freeLabel: freeLabel),
        action: #selector(CaptureAspectMenuTarget.picked(_:)),
        keyEquivalent: "")
      item.representedObject = preset.rawValue
      item.state = preset == aspectPreset ? .on : .off
      item.target = handler
      menu.addItem(item)
    }
    if mode == .screenshot {
      menu.addItem(.separator())
      menu.addItem(.sectionHeader(title: strings.text(CaptureToolsStringKey.captureCornerSection)))
      for radius in CaptureCornerRadiusPopover.presets {
        let title =
          radius == 0
          ? strings.text(CaptureToolsStringKey.cornerSharpBadge)
          : strings.text(CaptureToolsStringKey.cornerRadiusShort, count: Int(radius))
        let item = NSMenuItem(
          title: title,
          action: #selector(CaptureAspectMenuTarget.pickedCorner(_:)),
          keyEquivalent: "")
        item.representedObject = Double(radius)
        item.state = abs(captureCornerRadius - radius) < 0.5 ? .on : .off
        item.target = handler
        menu.addItem(item)
      }
    }
    NSMenu.popUpContextMenu(menu, with: event, for: overlay)
    aspectMenuTarget = nil
  }

  func applyAspectPreset(_ preset: SelectionAspectPreset) {
    aspectPreset = preset
    guard case .selected(let rect) = phase else { return }
    if preset == .free {
      show(rect, handles: true)
      return
    }
    let next = model.applyingAspectPreset(preset, to: rect)
    move(to: next, readAfter: CaptureTextReader.settleDelay)
  }

  func updateSpacePan(active: Bool, at point: CGPoint) {
    guard isActive else {
      spacePanAnchor = nil
      return
    }
    if active { confirmDoubleClick.disarm() }
    spacePanAnchor = active ? point : nil
  }

  func handleDragMoved(to point: CGPoint, constrained: Bool, centered: Bool) {
    if let anchor = spacePanAnchor {
      confirmDoubleClick.disarm()
      let delta = CGVector(dx: point.x - anchor.x, dy: point.y - anchor.y)
      spacePanAnchor = point
      panActiveDrag(by: delta, to: point, constrained: constrained, centered: centered)
      return
    }
    switch phase {
    case .pressing(_, let start):
      guard !SelectionModel.isClick(from: start, to: point) else { return }
      let drag = SelectionDrag.create(origin: model.clamped(start))
      phase = .creating(drag)
      showCreating(drag, at: point, constrained: constrained, centered: centered)
    case .creating(let drag):
      showCreating(drag, at: point, constrained: constrained, centered: centered)
    case .adjusting(let drag):
      if case .move = drag {
        confirmDoubleClick.trackDrag(to: point)
      } else {
        confirmDoubleClick.disarm()
      }
      let rect = model.rect(
        for: drag, to: point, constrained: constrained, centered: centered,
        aspect: aspectPreset.ratio
      )
      show(rect, handles: true)
      showLoupe(at: model.loupePoint(for: drag, rect: rect, pointer: point))
      follow(rect)
    case .idle, .selected, .longScreenshot:
      break
    }
  }

  func handleDragEnded(
    at point: CGPoint, constrained: Bool, centered: Bool,
    timestamp: TimeInterval = ProcessInfo.processInfo.systemUptime
  ) {
    spacePanAnchor = nil
    switch phase {
    case .pressing(let owner, let start):
      let selection = model.settled(offeredArea(on: owner))
      let pick = pickedElement(at: start, on: owner, selection: selection)
      commit(selection)
      self.pick = pick
    case .creating(let drag):
      commit(
        model.rect(
          for: drag, to: point, constrained: constrained, centered: centered,
          aspect: aspectPreset.ratio))
    case .adjusting(let drag):
      var nextDoubleClick = confirmDoubleClick
      if case .move = drag {
        nextDoubleClick.endPress(at: point, timestamp: timestamp)
      } else {
        nextDoubleClick.disarm()
      }
      move(
        to: model.rect(
          for: drag, to: point, constrained: constrained, centered: centered,
          aspect: aspectPreset.ratio))
      confirmDoubleClick = nextDoubleClick
    case .idle, .selected, .longScreenshot:
      break
    }
  }

  private func panActiveDrag(
    by delta: CGVector, to point: CGPoint, constrained: Bool, centered: Bool
  ) {
    switch phase {
    case .creating(let drag):
      guard case .create(let origin) = drag else { return }
      let shifted = SelectionDrag.create(
        origin: model.clamped(
          CGPoint(
            x: origin.x + delta.dx, y: origin.y + delta.dy)))
      phase = .creating(shifted)
      showCreating(shifted, at: point, constrained: constrained, centered: centered)
    case .adjusting(let drag):
      let shifted: SelectionDrag
      switch drag {
      case .create(let origin):
        shifted = .create(
          origin: model.clamped(
            CGPoint(
              x: origin.x + delta.dx, y: origin.y + delta.dy)))
      case .resize(let handle, let original):
        let moved = original.offsetBy(dx: delta.dx, dy: delta.dy)
        let clampedX = min(
          max(moved.minX, model.bounds.minX),
          max(model.bounds.minX, model.bounds.maxX - moved.width))
        let clampedY = min(
          max(moved.minY, model.bounds.minY),
          max(model.bounds.minY, model.bounds.maxY - moved.height))
        shifted = .resize(
          handle, original: CGRect(origin: CGPoint(x: clampedX, y: clampedY), size: moved.size))
      case .move:
        shifted = drag
      }
      phase = .adjusting(shifted)
      let rect = model.rect(
        for: shifted, to: point, constrained: constrained, centered: centered,
        aspect: aspectPreset.ratio)
      show(rect, handles: true)
      showLoupe(at: model.loupePoint(for: shifted, rect: rect, pointer: point))
      follow(rect)
    case .idle, .pressing, .selected, .longScreenshot:
      break
    }
  }

  func showCreating(
    _ drag: SelectionDrag, at point: CGPoint, constrained: Bool, centered: Bool
  ) {
    let rect = model.rect(
      for: drag, to: point, constrained: constrained, centered: centered, aspect: aspectPreset.ratio
    )
    show(rect, handles: false)
    showLoupe(at: model.clamped(point))
  }

  /// Ends the session like ``confirm()``, with the result saved locally to a folder or chosen file.
  func save(trigger: FinishTrigger = .unknown) {
    if options.saveFolder != nil {
      end(trigger: trigger) { .saved($0, destination: nil) }
      return
    }
    editor?.endText()
    guard case .selected(let rect) = phase,
      !desktop.geometry.displays(overlapping: rect).isEmpty,
      !choosingSaveDestination
    else { return }
    choosingSaveDestination = true
    let suggestedName = ScreenshotRules.fileName(capturedAt: Date(), encoding: .png)
    Task { @MainActor [weak self] in
      guard let self, !isFinished, choosingSaveDestination else { return }
      let panel = CaptureSavePanel()
      savePanel = panel
      let destination = panel.choose(suggestedName: suggestedName, contentType: .png)
      savePanel = nil
      choosingSaveDestination = false
      guard !isFinished else { return }
      if let destination {
        end(trigger: trigger) { .saved($0, destination: destination) }
      } else if hasKeyboard, case .selected(let currentRect) = phase {
        primaryOverlay(for: currentRect)?.window?.makeKey()
      }
    }
  }
}

private final class CaptureAspectMenuTarget: NSObject {
  private let onPickAspect: (SelectionAspectPreset) -> Void
  private let onPickCorner: (CGFloat) -> Void

  init(
    onPickAspect: @escaping (SelectionAspectPreset) -> Void,
    onPickCorner: @escaping (CGFloat) -> Void
  ) {
    self.onPickAspect = onPickAspect
    self.onPickCorner = onPickCorner
  }

  @objc func picked(_ sender: NSMenuItem) {
    guard let raw = sender.representedObject as? String,
      let preset = SelectionAspectPreset(rawValue: raw)
    else { return }
    onPickAspect(preset)
  }

  @objc func pickedCorner(_ sender: NSMenuItem) {
    guard let value = sender.representedObject as? Double else { return }
    onPickCorner(CGFloat(value))
  }
}
