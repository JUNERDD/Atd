import AICore
import AppKit

extension AnnotationInteraction {
  /// Returns the interactive grip (including curve midpoint `.bend`, step pull-out `.end`, and
  /// auto-width text `.left`/`.right` handles) within tolerance of `point`.
  func extendedHandle(at point: CGPoint) -> AnnotationHandle? {
    guard store.selectedIDs.count == 1, let selected = store.selected else { return nil }
    let reach = AnnotationPressTarget.gripReach
    return selected.interactiveHandles
      .filter { AnnotationMath.distance($0.point, point) <= reach }
      .min { AnnotationMath.distance($0.point, point) < AnnotationMath.distance($1.point, point) }?
      .handle
  }

  func beginMoveOrClone(
    hit: Annotation,
    at point: CGPoint,
    effectiveTool: AnnotationTool,
    shift: Bool,
    option: Bool
  ) {
    if effectiveTool == .select, shift {
      toggleMultiSelection(hit.id)
      if store.selectedIDs.contains(hit.id) {
        setGesture(.movingGroup(store.selectedAnnotations, start: point, cloned: false))
      }
      return
    }
    if !store.selectedIDs.contains(hit.id) {
      store.selectedIDs = [hit.id]
    }
    let items = store.selectedAnnotations
    if option, !items.isEmpty {
      var doc = store.document
      let clones = doc.duplicate(Set(items.map(\.id)), offset: .zero)
      let clonedItems = doc.annotations.filter { clones.contains($0.id) }
      store.preview = doc
      store.selectedIDs = clones
      setGesture(.movingGroup(clonedItems, start: point, cloned: true))
    } else {
      setGesture(.movingGroup(items, start: point, cloned: false))
    }
  }

  func beginCanvasDraw(
    at point: CGPoint, clickCount: Int, shift: Bool,
    timestamp: TimeInterval = ProcessInfo.processInfo.systemUptime
  ) {
    guard let tool else {
      confirmDoubleClick.disarm()
      return
    }
    switch tool {
    case .select:
      if !shift,
        confirmDoubleClick.beginPress(at: point, clickCount: clickCount, timestamp: timestamp)
      {
        onConfirm?()
        return
      }
      if shift { confirmDoubleClick.disarm() }
      marqueeRect = CGRect(origin: point, size: .zero)
      setGesture(.marquee(start: point, current: point, additive: shift))
      store.onChange?()
    case .text:
      confirmDoubleClick.disarm()
      textBoxPreview = CGRect(origin: point, size: .zero)
      setGesture(.creatingTextBox(start: point, current: point))
      store.onChange?()
    case .mosaic where styles[.shared].mosaicMode == .brush:
      confirmDoubleClick.disarm()
      let annotation = Annotation(shape: .mosaicBrush([point]), style: styles[.shared])
      setGesture(.drawing(annotation, start: point, dragged: false))
      store.preview = Self.document(store.document, adding: annotation)
    default:
      confirmDoubleClick.disarm()
      guard let shape = tool.initialShape(at: point) else { return }
      let annotation = Annotation(shape: shape, style: styles[tool.styleSlot])
      setGesture(.drawing(annotation, start: point, dragged: false))
      // Tools that box elements stay hidden until drag exceeds click reach.
      if !tool.boxesElements {
        store.preview = Self.document(store.document, adding: annotation)
      }
    }
  }

  func dragGroup(
    originals: [Annotation],
    start: CGPoint,
    cloned: Bool,
    to point: CGPoint,
    constrained: Bool
  ) {
    var delta = CGVector(dx: point.x - start.x, dy: point.y - start.y)
    if constrained {
      if abs(delta.dx) >= abs(delta.dy) { delta.dy = 0 } else { delta.dx = 0 }
    }
    let baseDoc = cloned ? (store.preview ?? store.document) : store.document
    let movingIDs = Set(originals.map(\.id))
    var docWithOriginals = baseDoc
    for item in originals { docWithOriginals.update(item) }
    let snapped = docWithOriginals.snapOffset(
      for: movingIDs, proposedDelta: delta, in: selectionBounds)
    activeSnapGuides = snapped.guides
    var updated = docWithOriginals
    for item in originals { updated.update(item.moved(by: snapped.delta)) }
    store.preview = updated
  }

  func scheduleSmartShapeDwell(annotation: Annotation, points: [CGPoint]) {
    guard points.count >= 6 else { return }
    let snapID = annotation.id
    pendingSmartShapeID = snapID
    smartShapeTimer = Timer.scheduledTimer(
      withTimeInterval: AnnotationSmartShape.dwellInterval,
      repeats: false
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self,
          case .drawing(var current, let start, let dragged) = self.gesture,
          current.id == snapID,
          let snapped = AnnotationSmartShape.classify(points)
        else { return }
        current.shape = snapped
        self.setGesture(.drawing(current, start: start, dragged: dragged))
        self.store.preview = Self.document(self.store.document, adding: current)
        self.onSmartShapeSnapped?(Self.smartShapeLabel(snapped))
      }
    }
  }

  func cancelSmartShapeTimer() {
    smartShapeTimer?.invalidate()
    smartShapeTimer = nil
    pendingSmartShapeID = nil
  }

  func toggleMultiSelection(_ id: UUID) {
    if store.selectedIDs.contains(id) {
      store.selectedIDs.remove(id)
    } else {
      store.selectedIDs.insert(id)
    }
  }

  func duplicateSelection() -> Bool {
    guard !store.selectedIDs.isEmpty else { return false }
    var doc = store.document
    let created = doc.duplicate(store.selectedIDs)
    guard !created.isEmpty else { return false }
    store.commit(doc)
    store.selectedIDs = created
    return true
  }

  func selectAllAnnotations() -> Bool {
    guard !store.document.isEmpty else { return false }
    store.selectAll()
    return true
  }

  /// Deletes all selected annotations; false when nothing is selected.
  func deleteSelection() -> Bool {
    guard !store.selectedIDs.isEmpty else { return false }
    var document = store.document
    document.remove(store.selectedIDs)
    guard document != store.document else { return false }
    store.commit(document)
    return true
  }

  /// Removes every annotation as one undo step; false when there is none.
  func clearAll() -> Bool {
    guard !store.document.isEmpty else { return false }
    cancelGesture()
    var next = store.document
    next.replaceAll([])
    store.commit(next)
    return true
  }

  /// Moves all selected annotations by `offset`; false when nothing is selected.
  func nudgeSelection(by offset: CGVector) -> Bool {
    guard !store.selectedIDs.isEmpty else { return false }
    var document = store.document
    document.move(store.selectedIDs, by: offset)
    guard document != store.document else { return false }
    store.commit(document)
    return true
  }

  private static func smartShapeLabel(_ shape: AnnotationShape) -> String {
    let key: ShellStringKey =
      switch shape {
      case .rectangle: .captureToolRectangle
      case .ellipse: .captureToolEllipse
      case .arrow: .captureToolArrow
      case .line: .captureToolLine
      default: .captureToolPen
      }
    return ShellStrings.shared.text(key)
  }
}
