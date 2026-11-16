import AICore
import AppKit

/// Transient baseline captured when dragging a multi-selection group handle.
struct GroupResizeState {
  let originals: [Annotation]
  let originalBounds: CGRect
}

extension AnnotationInteraction {
  /// Returns the combined selection frame (inset by 5pt) when multiple annotations are selected.
  func groupSelectionRect() -> CGRect? {
    guard store.selectedIDs.count > 1,
      let union = store.document.unionBounds(of: store.selectedIDs)
    else { return nil }
    return union.insetBy(dx: -5, dy: -5)
  }

  /// Returns one of the 8 group-bounds handles within grip reach of `point`, if multi-selecting.
  func groupHandle(at point: CGPoint) -> AnnotationHandle? {
    guard let frame = groupSelectionRect() else { return nil }
    let handles: [(AnnotationHandle, CGPoint)] = SelectionHandle.allCases.map { handle in
      let mapped: AnnotationHandle =
        switch handle {
        case .topLeft: .topLeft
        case .top: .top
        case .topRight: .topRight
        case .right: .right
        case .bottomRight: .bottomRight
        case .bottom: .bottom
        case .bottomLeft: .bottomLeft
        case .left: .left
        }
      return (mapped, handle.point(on: frame))
    }
    let reach = AnnotationPressTarget.gripReach
    return handles.filter { AnnotationMath.distance($0.1, point) <= reach }
      .min { AnnotationMath.distance($0.1, point) < AnnotationMath.distance($1.1, point) }?.0
  }

  /// Hits the corner-radius grip when a single `.rectangle` or sharp `.spotlight` is selected.
  func cornerRadiusHandle(at point: CGPoint) -> AnnotationHandle? {
    guard store.selectedIDs.count == 1, let selected = store.selected,
      let handlePoint = selected.cornerRadiusHandlePoint()
    else { return nil }
    return AnnotationMath.distance(handlePoint, point) <= AnnotationPressTarget.gripReach
      ? .cornerRadius : nil
  }

  /// Double-clicking the corner-radius handle toggles between `0` (sharp) and `12 pt`.
  func toggleCornerRadiusDefault(_ selected: Annotation) {
    let next: CGFloat = selected.style.displayCornerRadius > 0 ? 0 : 12
    var reset = selected
    reset.style = selected.style.with(
      cornerStyle: next > 0 ? .rounded : .sharp,
      cornerRadius: .some(next > 0 ? next : nil))
    store.commit(Self.document(store.document, replacing: reset))
    onCornerRadiusChanged?(next)
  }

  /// Whether a press at `point` lands on an existing annotation, handle, or text even if `tool == nil`.
  func hasDirectTarget(at point: CGPoint) -> Bool {
    if groupHandle(at: point) != nil
      || cornerRadiusHandle(at: point) != nil
      || extendedHandle(at: point) != nil
    {
      return true
    }
    return store.document.pressTarget(
      at: point, tool: tool ?? .select, selectedID: store.selectedID) != .canvas
  }

  /// Returns the front-most `.text` annotation containing `point`, regardless of active tool.
  func editableTextAnnotation(at point: CGPoint) -> Annotation? {
    store.document.annotations.last {
      $0.isText && $0.contains(point, tolerance: AnnotationPressTarget.slack)
    }
  }

  /// Resolves the pointer cursor across active tools, multi-select handles, and direct targets.
  func directManipulationCursor(at point: CGPoint) -> NSCursor? {
    if eyedropperActive { return PointerRole.marquee.cursor }
    if case .idle = gesture {
      if let group = groupHandle(at: point) { return group.cursor }
      if let grip = cornerRadiusHandle(at: point) ?? extendedHandle(at: point) {
        return grip.cursor
      }
    }
    if let toolCursor = cursor(at: point) {
      return toolCursor
    }
    switch gesture {
    case .moving, .movingGroup: return PointerRole.grabbing.cursor
    case .resizing(_, let handle): return handle.cursor
    case .marquee, .creatingTextBox: return PointerRole.marquee.cursor
    case .drawing, .idle: break
    }
    if let grip = cornerRadiusHandle(at: point) ?? extendedHandle(at: point) {
      return grip.cursor
    }
    switch store.document.pressTarget(at: point, tool: .select, selectedID: store.selectedID) {
    case .grip(let handle): return handle.cursor
    case .annotation, .text: return PointerRole.grab.cursor
    case .canvas: return nil
    }
  }

  func beginGroupResize(handle: AnnotationHandle) -> Bool {
    let items = store.selectedAnnotations
    guard items.count > 1, let bounds = store.document.unionBounds(of: store.selectedIDs) else {
      return false
    }
    groupResize = GroupResizeState(originals: items, originalBounds: bounds)
    setGesture(.resizing(items[0], handle))
    return true
  }

  func updateGroupResize(
    handle: AnnotationHandle, to point: CGPoint, constrained: Bool, centered: Bool
  ) {
    guard let groupResize else { return }
    var doc = store.document
    doc.resizeGroup(
      groupResize.originals, from: groupResize.originalBounds, handle: handle, to: point,
      constrained: constrained, centered: centered
    ) { [self] text, style, widthLimit in
      measureTextSize(text, style: style, fixedWidth: widthLimit)
    }
    store.preview = doc
  }

  /// Measures text using `AnnotationRenderer.textAttributes(_:)` so custom fonts and plates match.
  func measureTextSize(_ text: String, style: AnnotationStyle, fixedWidth: CGFloat?) -> CGSize {
    let attrs = AnnotationRenderer.textAttributes(style)
    let sample = text.isEmpty ? " " : text
    let limit = CGSize(
      width: fixedWidth ?? .greatestFiniteMagnitude,
      height: .greatestFiniteMagnitude)
    let bounds = NSAttributedString(string: sample, attributes: attrs).boundingRect(
      with: limit, options: [.usesLineFragmentOrigin])
    let minLine = ceil(NSAttributedString(string: " ", attributes: attrs).size().height)
    let width = fixedWidth ?? max(ceil(bounds.width) + 2, 12)
    return CGSize(width: width, height: max(ceil(bounds.height), minLine))
  }

  /// Refits `.text` annotations in `doc` matching `ids` after font family or size changes.
  func refitText(for ids: Set<UUID>?, in doc: inout AnnotationDocument) {
    doc.refitTextAnnotations(matching: ids) { text, style, widthLimit in
      measureTextSize(text, style: style, fixedWidth: widthLimit)
    }
  }

  /// Refits every `.text` annotation using `family` (e.g. after asynchronous font activation).
  func refitTexts(forFontFamily family: String) {
    var doc = store.document
    let changed = doc.refitTextAnnotations(fontFamily: family) { text, style, widthLimit in
      measureTextSize(text, style: style, fixedWidth: widthLimit)
    }
    if changed { store.commit(doc) }
  }

  /// Resizes a single annotation, reflowing `.text` box height when width changes.
  func resizedAnnotation(
    _ original: Annotation,
    handle: AnnotationHandle,
    to point: CGPoint,
    constrained: Bool,
    centered: Bool
  ) -> Annotation {
    if handle == .cornerRadius {
      let rect: CGRect? =
        switch original.shape {
        case .rectangle(let r): r
        case .spotlight(let r) where original.style.spotlightShape == .sharp: r
        default: nil
        }
      guard let rect else { return original }
      let radius = Annotation.draggedCornerRadius(in: rect, to: point)
      var next = original
      next.style = original.style.with(
        cornerStyle: radius > 0 ? .rounded : .sharp,
        cornerRadius: .some(radius > 0 ? radius : nil))
      onCornerRadiusChanged?(radius)
      return next
    }
    if case .text(let string, _) = original.shape {
      var next = original.resized(handle, to: point, constrained: constrained, centered: centered)
      if case .text(_, var frame) = next.shape {
        let width = max(frame.width, 24)
        let measured = measureTextSize(string, style: next.style, fixedWidth: width)
        frame.size = CGSize(width: width, height: measured.height)
        next.shape = .text(string, frame: frame)
      }
      return next
    }
    return AnnotationRenderer.fittingTextBox(
      original.resized(handle, to: point, constrained: constrained, centered: centered))
  }

  func bringSelectionToFront() -> Bool {
    guard !store.selectedIDs.isEmpty else { return false }
    var doc = store.document
    doc.bringToFront(store.selectedIDs)
    store.commit(doc)
    return true
  }

  func sendSelectionToBack() -> Bool {
    guard !store.selectedIDs.isEmpty else { return false }
    var doc = store.document
    doc.sendToBack(store.selectedIDs)
    store.commit(doc)
    return true
  }

  func copySelectedAnnotations() -> Bool {
    let items = store.selectedAnnotations
    guard !items.isEmpty else { return false }
    store.copiedAnnotations = items
    return true
  }

  func pasteCopiedAnnotations() -> Bool {
    guard !store.copiedAnnotations.isEmpty else { return false }
    var doc = store.document
    var newIDs = Set<UUID>()
    for item in store.copiedAnnotations {
      let copy = Annotation(
        shape: item.moved(by: CGVector(dx: 16, dy: 16)).shape, style: item.style)
      doc.add(copy)
      newIDs.insert(copy.id)
    }
    store.copiedAnnotations = doc.annotations.filter { newIDs.contains($0.id) }
    store.commit(doc)
    store.selectedIDs = newIDs
    return true
  }
}
