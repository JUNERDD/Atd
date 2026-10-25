import AICore
import AppKit

extension TaskActivityController {
  /// Called only for discrete layout/data changes. Direction stays fixed during a self drag.
  func layoutChanged() {
    guard let screen = mini.screen(), let layout = mini.layout else { return }
    if mini.model.phase.isDragging || mini.snap != nil || mini.snapInterrupted {
      // Retain the attachment side while moving, but keep popup coordinates current so an
      // interrupted snap can open the card without using the previous canvas or shifting twice.
      placePopover()
      return phaseChanged()
    }
    measureCard()
    let capsule = NSRect(layout.capsule)
    let work = screen.visibleFrame
      .insetBy(dx: MiniPanelMetrics.margin, dy: MiniPanelMetrics.margin)
      .intersection(NSRect(layout.canvas))
    let side = TaskActivityMetrics.entrySide
    let gap = TaskActivityMetrics.gap
    let below = CGRect(
      x: capsule.midX - side / 2, y: capsule.minY - gap - side, width: side, height: side)
    let above = CGRect(x: capsule.midX - side / 2, y: capsule.maxY + gap, width: side, height: side)
    let candidates = model.below ? [below, above] : [above, below]
    guard let entry = candidates.first(where: { work.contains($0) }) else {
      model.entryAvailable = false
      model.cardAvailable = false
      phaseChanged()
      return
    }
    model.below = entry == below
    model.entryAvailable = true
    var occupied = [capsule]
    if mini.model.flyoutOpen, let flyout = layout.flyout { occupied.append(NSRect(flyout)) }
    if let card = activityCard(beside: entry, avoiding: occupied, in: work) {
      let offset = CGSize(width: card.minX - entry.minX, height: entry.maxY - card.maxY)
      if model.cardOffset != offset { model.cardOffset = offset }
      model.cardAvailable = true
    } else {
      model.cardAvailable = false
    }
    placePopover()
    phaseChanged()
  }

  private func placePopover() {
    let rest = CGRect(origin: entryLocal.origin, size: model.cardSize)
      .offsetBy(dx: model.cardOffset.width, dy: model.cardOffset.height)
    let inset = min(MiniPanelMetrics.cardRadius, rest.height / 2)
    let anchor = CGRect(
      x: mini.model.edge == .right ? rest.maxX : rest.minX,
      y: min(max(entryLocal.midY, rest.minY + inset), rest.maxY - inset),
      width: 0, height: 0)
    // The open card's own content changed its height where it stands: its glass springs to
    // the new size with the content. Its lane only grows meanwhile, so it holds both sizes and
    // keeps its origin (the glass is drawn relative to it). A move or a change of width lands
    // at once, as the Command card's layout changes do.
    let current = model.popover.rest
    let resizes =
      model.popover.isOpen && current.height > 0 && current.minX == rest.minX
      && current.width == rest.width && current.height != rest.height
    model.popover.place(
      rest: rest, anchor: anchor, reducedMotion: model.reducedMotion,
      resize: resizes ? TaskActivityMotion.resize : nil)
    let lane = rest.union(mini.model.bodyLane)
      .insetBy(dx: -MiniPanelMetrics.overshootRoom, dy: -MiniPanelMetrics.overshootRoom)
    model.cardLane = resizes ? lane.union(model.cardLane) : lane
  }

  /// Preserve the original capsule and command flyout, within the shared window's canvas.
  private func activityCard(beside entry: CGRect, avoiding occupied: [CGRect], in work: CGRect)
    -> CGRect?
  {
    let size = measuredCardSize
    guard size.width <= work.width, size.height <= work.height else { return nil }
    let gap = TaskActivityMetrics.gap
    let right = mini.model.edge == .right
    let inwardX = right ? entry.minX - gap - size.width : entry.maxX + gap
    let low = entry.maxY - size.height
    let high = entry.minY
    var candidates = [
      CGRect(origin: CGPoint(x: inwardX, y: low), size: size),
      CGRect(origin: CGPoint(x: inwardX, y: high), size: size),
    ]
    if let flyout = occupied.dropFirst().first {
      let beyond = right ? flyout.minX - gap - size.width : flyout.maxX + gap
      candidates += [
        CGRect(origin: CGPoint(x: beyond, y: low), size: size),
        CGRect(origin: CGPoint(x: inwardX, y: flyout.minY - gap - size.height), size: size),
        CGRect(origin: CGPoint(x: inwardX, y: flyout.maxY + gap), size: size),
      ]
    }
    // Releasing another popup's occupied area must not relocate a visible activity card,
    // especially during a simultaneous close. Move it only when its current place is invalid.
    if model.popover.visible {
      candidates.insert(
        CGRect(
          x: entry.minX + model.cardOffset.width,
          y: entry.maxY - model.cardOffset.height - size.height,
          width: size.width, height: size.height), at: 0)
    }
    return candidates.map { rect in
      CGRect(
        x: min(max(rect.minX, work.minX), work.maxX - rect.width),
        y: min(max(rect.minY, work.minY), work.maxY - rect.height),
        width: rect.width, height: rect.height)
    }
    .first { candidate in
      !occupied.contains { $0.insetBy(dx: -gap / 2, dy: -gap / 2).intersects(candidate) }
        && !entry.insetBy(dx: -gap / 2, dy: -gap / 2).intersects(candidate)
    }
  }
}
