import AICore
import AppKit

extension AnnotationCanvasView {
  override func rightMouseDown(with event: NSEvent) {
    guard !textEditor.isEditing else {
      super.rightMouseDown(with: event)
      return
    }
    let pt = convert(event.locationInWindow, from: nil)
    let hitTarget = store.document.pressTarget(at: pt, tool: .select, selectedID: store.selectedID)
    let hitID: UUID? =
      switch hitTarget {
      case .annotation(let id), .text(let id): id
      case .grip, .canvas: nil
      }
    if let hitID, !store.selectedIDs.contains(hitID) {
      store.selectedIDs = [hitID]
      needsDisplay = true
    }
    guard !store.selectedIDs.isEmpty else {
      super.rightMouseDown(with: event)
      return
    }
    let strings = ShellStrings.shared
    let menu = NSMenu()
    menu.addItem(
      menuItem(
        title: strings.text(CaptureToolsStringKey.menuDuplicate),
        action: #selector(menuDuplicate),
        keyEquivalent: "d",
        modifiers: .command))
    menu.addItem(
      menuItem(
        title: strings.text(CaptureToolsStringKey.menuCopyAnnotation),
        action: #selector(menuCopyAnnotation),
        keyEquivalent: "C",
        modifiers: [.command, .shift]))
    if !store.copiedAnnotations.isEmpty {
      menu.addItem(
        menuItem(
          title: strings.text(CaptureToolsStringKey.menuPasteAnnotation),
          action: #selector(menuPasteAnnotation),
          keyEquivalent: "v",
          modifiers: .command))
    }
    menu.addItem(.separator())
    menu.addItem(
      menuItem(
        title: strings.text(CaptureToolsStringKey.menuBringToFront),
        action: #selector(menuBringToFront),
        keyEquivalent: "]",
        modifiers: .command))
    menu.addItem(
      menuItem(
        title: strings.text(CaptureToolsStringKey.menuSendToBack),
        action: #selector(menuSendToBack),
        keyEquivalent: "[",
        modifiers: .command))
    if let single = store.selected, single.shape.bendPoint != nil {
      menu.addItem(.separator())
      menu.addItem(
        menuItem(
          title: strings.text(CaptureToolsStringKey.menuStraightenCurve),
          action: #selector(menuStraightenCurve),
          keyEquivalent: "",
          modifiers: []))
    }
    menu.addItem(.separator())
    menu.addItem(
      menuItem(
        title: strings.text(CaptureToolsStringKey.menuDelete),
        action: #selector(menuDelete),
        keyEquivalent: "\u{08}",
        modifiers: []))
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  private func menuItem(
    title: String,
    action: Selector,
    keyEquivalent: String,
    modifiers: NSEvent.ModifierFlags
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
    item.keyEquivalentModifierMask = modifiers
    item.target = self
    return item
  }

  @objc private func menuDuplicate() {
    _ = interaction.duplicateSelection()
  }

  @objc private func menuCopyAnnotation() {
    if interaction.copySelectedAnnotations() {
      showSizeHud(ShellStrings.shared.text(CaptureToolsStringKey.toastCopiedAnnotation))
    }
  }

  @objc private func menuPasteAnnotation() {
    _ = interaction.pasteCopiedAnnotations()
  }

  @objc private func menuBringToFront() {
    _ = interaction.bringSelectionToFront()
  }

  @objc private func menuSendToBack() {
    _ = interaction.sendSelectionToBack()
  }

  @objc private func menuStraightenCurve() {
    guard var item = store.selected, item.shape.bendPoint != nil else { return }
    item.shape = item.shape.withBend(nil)
    var doc = store.document
    doc.update(item)
    store.commit(doc)
  }

  @objc private func menuDelete() {
    _ = interaction.deleteSelection()
  }

  // MARK: Open Text Chrome & Outlines

  func openTextOutlineRect() -> (frame: CGRect, outline: CGRect, plateRightPad: CGFloat)? {
    guard let frame = textEditor.frame, let style = textEditor.style, textEditor.isHosted(in: self)
    else { return nil }
    var area = frame
    let plate = style.resolvedTextPlate
    if plate == .solid || plate == .frosted {
      area = AnnotationPath.textPlate(around: frame, fontSize: style.textFontSize)
    }
    let outline = area.insetBy(dx: -4, dy: -3)
    return (frame, outline, outline.maxX - frame.maxX)
  }

  func openTextWidthGripHit(at point: CGPoint) -> Bool {
    guard let info = openTextOutlineRect() else { return false }
    let gripCenter = CGPoint(x: info.outline.maxX, y: info.outline.midY)
    return AnnotationMath.distance(point, gripCenter) <= AnnotationPressTarget.gripReach + 2
  }

  /// Draws the plate, dashed outline, and east width-reflow grip for the open text editor.
  func drawOpenTextChrome(frame: CGRect, style: AnnotationStyle, in context: CGContext) {
    let plate = style.resolvedTextPlate
    if plate == .solid || plate == .frosted {
      AnnotationRenderer.drawTextPlate(around: frame, style: style, in: context)
    }
    guard let info = openTextOutlineRect() else { return }
    Self.outline(info.outline, in: context)
    let grip = CGRect(x: info.outline.maxX - 4, y: info.outline.midY - 4, width: 8, height: 8)
    context.saveGState()
    context.setFillColor(NSColor.white.cgColor)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.setLineWidth(1.5)
    context.fillEllipse(in: grip)
    context.strokeEllipse(in: grip)
    context.restoreGState()
  }

  static func outline(_ rect: CGRect, in context: CGContext, width: CGFloat = 1) {
    context.saveGState()
    context.setLineWidth(width)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.setLineDash(phase: 0, lengths: [4, 3])
    context.stroke(rect.insetBy(dx: width / 2, dy: width / 2))
    context.restoreGState()
  }
}
