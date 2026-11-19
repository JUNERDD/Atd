import CoreGraphics
import Foundation

/// Alignment guide lines shown while dragging annotations within snapping range.
public enum AnnotationSnapGuide: Equatable, Sendable {
  case vertical(x: CGFloat, ySpan: ClosedRange<CGFloat>)
  case horizontal(y: CGFloat, xSpan: ClosedRange<CGFloat>)
}

extension AnnotationDocument {
  /// Returns IDs of all annotations whose painted bounds intersect `marquee`.
  public func ids(intersecting marquee: CGRect) -> Set<UUID> {
    let rect = marquee.standardized
    return Set(annotations.compactMap { $0.bounds.intersects(rect) ? $0.id : nil })
  }

  /// Moves every annotation matching `ids` by `offset`.
  public mutating func move(_ ids: Set<UUID>, by offset: CGVector) {
    guard !ids.isEmpty, offset.dx != 0 || offset.dy != 0 else { return }
    replaceAll(annotations.map { ids.contains($0.id) ? $0.moved(by: offset) : $0 })
  }

  /// Applies a style change across every selected annotation that accepts it.
  public mutating func applyStyle(_ change: AnnotationStyleChange, to ids: Set<UUID>) {
    guard !ids.isEmpty else { return }
    replaceAll(
      annotations.map { item in
        guard ids.contains(item.id) else { return item }
        var updated = item
        updated.style = change.applied(to: item.style)
        return updated
      }
    )
  }

  /// Deletes all annotations matching `ids`.
  public mutating func remove(_ ids: Set<UUID>) {
    guard !ids.isEmpty else { return }
    replaceAll(annotations.filter { !ids.contains($0.id) })
  }

  /// Duplicates `ids` offset by `offset`, placing copies in front of the originals,
  /// and returns the new IDs.
  public mutating func duplicate(_ ids: Set<UUID>, offset: CGVector = CGVector(dx: 12, dy: 12))
    -> Set<UUID>
  {
    let sources = annotations.filter { ids.contains($0.id) }
    guard !sources.isEmpty else { return [] }
    var next = annotations
    var created = Set<UUID>()
    for item in sources {
      let copy = Annotation(shape: item.moved(by: offset).shape, style: item.style)
      next.append(copy)
      created.insert(copy.id)
    }
    replaceAll(next)
    return created
  }

  /// Moves `ids` in front of all other annotations, preserving relative z-order among `ids`.
  public mutating func bringToFront(_ ids: Set<UUID>) {
    let front = annotations.filter { ids.contains($0.id) }
    guard !front.isEmpty else { return }
    let back = annotations.filter { !ids.contains($0.id) }
    replaceAll(back + front)
  }

  /// Moves `ids` behind all other annotations, preserving relative z-order among `ids`.
  public mutating func sendToBack(_ ids: Set<UUID>) {
    let back = annotations.filter { ids.contains($0.id) }
    guard !back.isEmpty else { return }
    let front = annotations.filter { !ids.contains($0.id) }
    replaceAll(back + front)
  }

  /// Snaps `movingIDs` translated by `proposedDelta` against sibling annotation edges/centers
  /// and selection midlines within `threshold` points.
  public func snapOffset(
    for movingIDs: Set<UUID>,
    proposedDelta: CGVector,
    in selection: CGRect?,
    threshold: CGFloat = 5
  ) -> (delta: CGVector, guides: [AnnotationSnapGuide]) {
    let movingBoxes = annotations.filter { movingIDs.contains($0.id) }.map {
      $0.bounds.offsetBy(dx: proposedDelta.dx, dy: proposedDelta.dy)
    }
    guard let union = unionRect(of: movingBoxes) else { return (proposedDelta, []) }

    var candidatesX: [(value: CGFloat, rect: CGRect)] = []
    var candidatesY: [(value: CGFloat, rect: CGRect)] = []
    for other in annotations where !movingIDs.contains(other.id) {
      let r = other.bounds
      candidatesX += [(r.minX, r), (r.midX, r), (r.maxX, r)]
      candidatesY += [(r.minY, r), (r.midY, r), (r.maxY, r)]
    }
    if let selection {
      candidatesX.append((selection.midX, selection))
      candidatesY.append((selection.midY, selection))
    }

    var dxAdjust: CGFloat = 0
    var bestXDist = threshold + 0.001
    var bestXMatch: (target: CGFloat, ref: CGRect)?
    for edge in [union.minX, union.midX, union.maxX] {
      for cand in candidatesX {
        let diff = cand.value - edge
        if abs(diff) < bestXDist {
          bestXDist = abs(diff)
          dxAdjust = diff
          bestXMatch = (cand.value, cand.rect)
        }
      }
    }

    var dyAdjust: CGFloat = 0
    var bestYDist = threshold + 0.001
    var bestYMatch: (target: CGFloat, ref: CGRect)?
    for edge in [union.minY, union.midY, union.maxY] {
      for cand in candidatesY {
        let diff = cand.value - edge
        if abs(diff) < bestYDist {
          bestYDist = abs(diff)
          dyAdjust = diff
          bestYMatch = (cand.value, cand.rect)
        }
      }
    }

    let snappedRect = union.offsetBy(dx: dxAdjust, dy: dyAdjust)
    var guides: [AnnotationSnapGuide] = []
    if let m = bestXMatch {
      let minY = min(snappedRect.minY, m.ref.minY) - 8
      let maxY = max(snappedRect.maxY, m.ref.maxY) + 8
      guides.append(.vertical(x: m.target, ySpan: minY...maxY))
    }
    if let m = bestYMatch {
      let minX = min(snappedRect.minX, m.ref.minX) - 8
      let maxX = max(snappedRect.maxX, m.ref.maxX) + 8
      guides.append(.horizontal(y: m.target, xSpan: minX...maxX))
    }
    let finalDelta = CGVector(dx: proposedDelta.dx + dxAdjust, dy: proposedDelta.dy + dyAdjust)
    return (finalDelta, guides)
  }

  /// Bounding box covering every annotation matching `ids`, if any exist.
  public func unionBounds(of ids: Set<UUID>) -> CGRect? {
    guard !ids.isEmpty else { return nil }
    return unionRect(of: annotations.compactMap { ids.contains($0.id) ? $0.bounds : nil })
  }

  /// Scales every annotation in `originals` proportionally from `originalBounds` by `handle` -> `point`.
  public mutating func resizeGroup(
    _ originals: [Annotation],
    from originalBounds: CGRect,
    handle: AnnotationHandle,
    to point: CGPoint,
    constrained: Bool = false,
    centered: Bool = false,
    measure: ((String, AnnotationStyle, CGFloat?) -> CGSize)? = nil
  ) {
    guard !originals.isEmpty, originalBounds.width > 0.5, originalBounds.height > 0.5 else {
      return
    }
    let target = Self.groupTargetBounds(
      from: originalBounds, handle: handle, to: point, constrained: constrained, centered: centered)
    let sx = target.width / originalBounds.width
    let sy = target.height / originalBounds.height
    let mapped = Dictionary(
      uniqueKeysWithValues: originals.map { item in
        (
          item.id,
          Self.scaledAnnotation(
            item, from: originalBounds, to: target, sx: sx, sy: sy, handle: handle,
            measure: measure)
        )
      })
    replaceAll(annotations.map { mapped[$0.id] ?? $0 })
  }

  /// Refits matching `.text` annotations using an external text layout measurement callback.
  @discardableResult
  public mutating func refitTextAnnotations(
    matching ids: Set<UUID>? = nil,
    fontFamily: String? = nil,
    measure: (String, AnnotationStyle, CGFloat?) -> CGSize
  ) -> Bool {
    var changed = false
    let next = annotations.map { item -> Annotation in
      guard case .text(let text, let frame) = item.shape else { return item }
      if let ids, !ids.contains(item.id) { return item }
      if let fontFamily, item.style.fontFamily != fontFamily { return item }
      let widthLimit: CGFloat? = item.style.fixedWidth ? max(frame.width, 12) : nil
      let measured = measure(text, item.style, widthLimit)
      let nextFrame = CGRect(
        origin: frame.origin,
        size: CGSize(width: widthLimit ?? max(measured.width, 12), height: max(measured.height, 14))
      )
      guard nextFrame != frame else { return item }
      changed = true
      var copy = item
      copy.shape = .text(text, frame: nextFrame)
      return copy
    }
    if changed { replaceAll(next) }
    return changed
  }

  private static func groupTargetBounds(
    from original: CGRect,
    handle: AnnotationHandle,
    to point: CGPoint,
    constrained: Bool,
    centered: Bool
  ) -> CGRect {
    let resized = Annotation(shape: .rectangle(original), style: AnnotationStyle())
      .resized(handle, to: point, constrained: false, centered: centered)
    var rect: CGRect =
      if case .rectangle(let resizedRect) = resized.shape { resizedRect } else { original }
    let minSide: CGFloat = 12
    let w = max(rect.width, minSide)
    let h = max(rect.height, minSide)
    if constrained && handle.horizontal != 0 && handle.vertical != 0 {
      let aspect = original.width / max(original.height, 1)
      let fittedW = max(w, h * aspect)
      let fittedH = max(h, fittedW / max(aspect, 0.01))
      if centered {
        rect = CGRect(
          x: original.midX - fittedW / 2, y: original.midY - fittedH / 2,
          width: fittedW, height: fittedH)
      } else {
        let anchorX = handle.horizontal < 0 ? original.maxX : original.minX
        let anchorY = handle.vertical < 0 ? original.maxY : original.minY
        rect = CGRect(
          x: handle.horizontal < 0 ? anchorX - fittedW : anchorX,
          y: handle.vertical < 0 ? anchorY - fittedH : anchorY,
          width: fittedW, height: fittedH)
      }
    } else if rect.width < minSide || rect.height < minSide {
      let anchorX =
        centered ? original.midX - w / 2 : (handle.horizontal < 0 ? original.maxX - w : rect.minX)
      let anchorY =
        centered ? original.midY - h / 2 : (handle.vertical < 0 ? original.maxY - h : rect.minY)
      rect = CGRect(x: anchorX, y: anchorY, width: w, height: h)
    }
    return rect
  }

  private static func scaledAnnotation(
    _ item: Annotation,
    from originalBounds: CGRect,
    to targetBounds: CGRect,
    sx: CGFloat,
    sy: CGFloat,
    handle: AnnotationHandle,
    measure: ((String, AnnotationStyle, CGFloat?) -> CGSize)?
  ) -> Annotation {
    func mapPoint(_ p: CGPoint) -> CGPoint {
      CGPoint(
        x: targetBounds.minX + (p.x - originalBounds.minX) * sx,
        y: targetBounds.minY + (p.y - originalBounds.minY) * sy)
    }
    func mapRect(_ r: CGRect) -> CGRect {
      CGRect(
        origin: mapPoint(r.origin),
        size: CGSize(width: max(4, r.width * sx), height: max(4, r.height * sy)))
    }
    var copy = item
    switch item.shape {
    case .rectangle(let r): copy.shape = .rectangle(mapRect(r))
    case .ellipse(let r): copy.shape = .ellipse(mapRect(r))
    case .mosaic(let r): copy.shape = .mosaic(mapRect(r))
    case .spotlight(let r): copy.shape = .spotlight(mapRect(r))
    case .arrow(let from, let to, let bend):
      copy.shape = .arrow(from: mapPoint(from), to: mapPoint(to), bend: bend.map(mapPoint))
    case .line(let from, let to, let bend):
      copy.shape = .line(from: mapPoint(from), to: mapPoint(to), bend: bend.map(mapPoint))
    case .pen(let pts): copy.shape = .pen(pts.map(mapPoint))
    case .highlighter(let pts): copy.shape = .highlighter(pts.map(mapPoint))
    case .mosaicBrush(let pts): copy.shape = .mosaicBrush(pts.map(mapPoint))
    case .step(let center, let tip):
      copy.shape = .step(center: mapPoint(center), tip: tip.map(mapPoint))
    case .text(let text, let frame):
      let isHorizontalOnly = handle.vertical == 0 && handle.horizontal != 0
      if isHorizontalOnly {
        copy.style.fixedWidth = true
        let nextW = max(24, frame.width * sx)
        let nextH = measure?(text, copy.style, nextW).height ?? frame.height
        copy.shape = .text(
          text,
          frame: CGRect(origin: mapPoint(frame.origin), size: CGSize(width: nextW, height: nextH)))
      } else {
        let baseFont = item.style.textFontSize
        let factor = handle.horizontal == 0 ? sy : min(sx, sy)
        copy.style.fontSize = min(max(baseFont * factor, 10), 96)
        let widthLimit: CGFloat? = copy.style.fixedWidth ? max(24, frame.width * sx) : nil
        let measured = measure?(text, copy.style, widthLimit)
        let size =
          measured
          ?? CGSize(
            width: widthLimit ?? max(12, frame.width * sx), height: max(14, frame.height * sy))
        copy.shape = .text(
          text,
          frame: CGRect(
            origin: mapPoint(frame.origin),
            size: CGSize(width: widthLimit ?? size.width, height: size.height)))
      }
    }
    return copy
  }

  private func unionRect(of rects: [CGRect]) -> CGRect? {
    guard var acc = rects.first else { return nil }
    for r in rects.dropFirst() { acc = acc.union(r) }
    return acc
  }
}
