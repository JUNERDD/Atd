import AICore
import AppKit

/// The pointer state machine of the annotation canvas. A gesture draws into the store's
/// preview and commits once on mouse-up, so each drawn, moved or resized annotation is one
/// undo step. Points are the overlay's view points (annotations stay put on the screen while
/// the selection moves), already clamped to the selection by the canvas. What a press reaches
/// is ``AnnotationDocument/pressTarget(at:tool:selectedID:)`` (decision D15); what a drag
/// draws is AICore's (`AnnotationDrawing.swift`).
final class AnnotationInteraction {
  /// The gesture in progress, which decides the cursor until the button is released.
  enum Gesture {
    case idle
    /// `dragged` turns true once the pointer has gone ``AnnotationPath/clickReach`` from
    /// `start`; until then a tool that boxes elements treats the press as a click (E10).
    case drawing(Annotation, start: CGPoint, dragged: Bool)
    case moving(Annotation, start: CGPoint)
    case movingGroup([Annotation], start: CGPoint, cloned: Bool)
    case marquee(start: CGPoint, current: CGPoint, additive: Bool)
    case creatingTextBox(start: CGPoint, current: CGPoint)
    case resizing(Annotation, AnnotationHandle)
  }

  let store: AnnotationStore
  /// Nil until a tool is chosen, and again after Esc drops it. Another tool deselects so the
  /// style bar targets the upcoming annotation instead of the previous tool's shape.
  var tool: AnnotationTool? {
    didSet { if tool != oldValue { store.selectedID = nil } }
  }
  /// The styles new annotations take, per slot (E8); the editor remembers them.
  var styles = AnnotationStyles.defaults {
    didSet { if styles != oldValue { onStylesChange?(styles) } }
  }
  var onStylesChange: ((AnnotationStyles) -> Void)?
  /// The element box a click at a point makes (smallest detected element clipped to selection).
  var elementBox: ((CGPoint) -> CGRect?)?
  /// Opens the text editor at a point, or on an existing text annotation.
  var onEditText: ((CGPoint, Annotation?) -> Void)?
  /// Opens a fixed-width text editor box dragged by the text tool.
  var onBeginTextBox: ((CGPoint, CGFloat?) -> Void)?
  /// Double-click on empty canvas with the select tool confirms, matching idle capture confirm.
  var onConfirm: (() -> Void)?
  /// Fired when a held freehand pen stroke snaps into a smart shape, carrying a localized name.
  var onSmartShapeSnapped: ((String) -> Void)?
  /// Fired while dragging or double-clicking the on-canvas corner-radius grip.
  var onCornerRadiusChanged: ((CGFloat) -> Void)?

  var eyedropperActive = false
  var hoveredRGBA: AnnotationRGBA?
  var selectionBounds: CGRect?
  var marqueeRect: CGRect?
  var textBoxPreview: CGRect?
  var activeSnapGuides: [AnnotationSnapGuide] = []
  var groupResize: GroupResizeState?
  var smartShapeTimer: Timer?
  var pendingSmartShapeID: UUID?

  private(set) var gesture = Gesture.idle

  var isGesturing: Bool {
    if case .idle = gesture { return false }
    return true
  }

  init(store: AnnotationStore) {
    self.store = store
  }

  func setGesture(_ next: Gesture) { gesture = next }

  /// What a press at `point` would reach with the current tool; nil before a tool is chosen.
  func target(at point: CGPoint) -> AnnotationPressTarget? {
    guard let tool else { return nil }
    return store.document.pressTarget(at: point, tool: tool, selectedID: store.selectedID)
  }

  /// Whether the pointer at `point` previews the element a click would box (E10): a tool that
  /// boxes elements, over empty canvas, until a press there turns into a drag.
  func previewsElement(at point: CGPoint) -> Bool {
    guard let tool, tool.boxesElements else { return false }
    switch gesture {
    case .idle: return target(at: point) == .canvas
    case .drawing(_, _, let dragged): return !dragged
    case .moving, .movingGroup, .marquee, .creatingTextBox, .resizing: return false
    }
  }

  func mouseDown(
    at point: CGPoint,
    clickCount: Int,
    shift: Bool = false,
    option: Bool = false
  ) {
    if let handle = groupHandle(at: point), beginGroupResize(handle: handle) {
      return
    }
    if let handle = cornerRadiusHandle(at: point) ?? extendedHandle(at: point),
      let selected = store.selected
    {
      if handle == .cornerRadius, clickCount >= 2 {
        toggleCornerRadiusDefault(selected)
        return
      }
      if handle == .bend, clickCount >= 2 {
        var reset = selected
        reset.shape = reset.shape.withBend(nil)
        store.commit(Self.document(store.document, replacing: reset))
        return
      }
      gesture = .resizing(selected, handle)
      return
    }
    if clickCount >= 2, let textHit = editableTextAnnotation(at: point) {
      onEditText?(point, textHit)
      return
    }

    let document = store.document
    let effectiveTool = tool ?? .select
    let pressTarget = document.pressTarget(
      at: point, tool: effectiveTool, selectedID: store.selectedID)
    switch pressTarget {
    case .grip(let handle):
      guard let selected = store.selected else { return }
      gesture = .resizing(selected, handle)
    case .text(let id):
      if shift, effectiveTool == .select {
        toggleMultiSelection(id)
        return
      }
      onEditText?(point, document[id])
    case .annotation(let id):
      guard let hit = document[id] else { return }
      if clickCount >= 2, hit.isText {
        onEditText?(point, hit)
        return
      }
      beginMoveOrClone(
        hit: hit, at: point, effectiveTool: effectiveTool, shift: shift, option: option)
    case .canvas:
      if !shift { store.selectedIDs = [] }
      beginCanvasDraw(at: point, clickCount: clickCount, shift: shift)
    }
  }

  func mouseDragged(to point: CGPoint, constrained: Bool, centered: Bool = false) {
    switch gesture {
    case .idle:
      return
    case .marquee(let start, _, let additive):
      let rect = AnnotationMath.rect(corners: start, point)
      marqueeRect = rect
      let hitIDs = store.document.ids(intersecting: rect)
      if additive {
        store.selectedIDs.formUnion(hitIDs)
      } else {
        store.selectedIDs = hitIDs
      }
      gesture = .marquee(start: start, current: point, additive: additive)
      store.onChange?()
    case .creatingTextBox(let start, _):
      textBoxPreview = AnnotationMath.rect(corners: start, point)
      gesture = .creatingTextBox(start: start, current: point)
      store.onChange?()
    case .moving(let original, let start):
      let offset = CGVector(dx: point.x - start.x, dy: point.y - start.y)
      store.preview = Self.document(store.document, replacing: original.moved(by: offset))
    case .movingGroup(let originals, let start, let cloned):
      dragGroup(
        originals: originals, start: start, cloned: cloned, to: point, constrained: constrained)
    case .resizing(let original, let handle):
      if groupResize != nil {
        updateGroupResize(handle: handle, to: point, constrained: constrained, centered: centered)
        return
      }
      let next = resizedAnnotation(
        original, handle: handle, to: point, constrained: constrained, centered: centered)
      store.preview = Self.document(store.document, replacing: next)
    case .drawing(var annotation, let start, let wasDragged):
      cancelSmartShapeTimer()
      let dragged = wasDragged || AnnotationMath.distance(start, point) >= AnnotationPath.clickReach
      // Tools that box elements stay a click until leaving click reach so clicks pick elements.
      if dragged || tool?.boxesElements != true {
        annotation.shape = annotation.shape.dragged(
          from: start, to: point, constrained: constrained)
        store.preview = Self.document(store.document, adding: annotation)
      }
      gesture = .drawing(annotation, start: start, dragged: dragged)
      if tool == .pen, case .pen(let pts) = annotation.shape, !constrained {
        scheduleSmartShapeDwell(annotation: annotation, points: pts)
      }
    }
  }

  func mouseUp() {
    cancelSmartShapeTimer()
    activeSnapGuides = []
    defer { gesture = .idle }
    switch gesture {
    case .idle:
      return
    case .marquee:
      marqueeRect = nil
      store.onChange?()
    case .creatingTextBox(let start, let current):
      let rect = AnnotationMath.rect(corners: start, current)
      textBoxPreview = nil
      if rect.width >= 24 {
        onBeginTextBox?(rect.origin, rect.width)
      } else {
        onEditText?(start, nil)
      }
      store.onChange?()
    case .drawing(let annotation, let start, let dragged):
      if !dragged, let tool, tool.boxesElements {
        boxElement(at: start, tool: tool, style: annotation.style)
        return
      }
      guard AnnotationPath.isSubstantial(annotation.shape), let preview = store.preview else {
        store.preview = nil
        return
      }
      store.commit(preview)
      store.selectedID = annotation.id
    case .moving, .movingGroup, .resizing:
      groupResize = nil
      store.commit(store.preview ?? store.document)
    }
  }

  /// A click without a drag: the shape over the element under the press, selected, as one
  /// undo step; nothing when no element is there (E10).
  private func boxElement(at point: CGPoint, tool: AnnotationTool, style: AnnotationStyle) {
    store.preview = nil
    guard let box = elementBox?(point), let shape = tool.elementBox(box) else { return }
    let annotation = Annotation(shape: shape, style: style)
    store.commit(Self.document(store.document, adding: annotation))
    store.selectedID = annotation.id
  }

  /// Applies a style bar change to all selected annotations (one undo step, or per `burst`).
  func apply(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    let selectedItems = store.selectedAnnotations
    let slot = selectedItems.first?.shape.styleSlot ?? tool?.styleSlot ?? .shared
    styles[slot] = change.applied(to: styles[slot])
    guard !selectedItems.isEmpty else { return }
    let ids = Set(selectedItems.map(\.id))
    var doc = store.document
    doc.applyStyle(change, to: ids)
    if change.stroke != nil || change.fontChoice != nil {
      refitText(for: ids, in: &doc)
    }
    store.commit(doc, burst: burst)
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

  /// Drops a gesture in progress (the editor hides or the tool changes mid-drag).
  func cancelGesture() {
    cancelSmartShapeTimer()
    activeSnapGuides = []
    groupResize = nil
    marqueeRect = nil
    textBoxPreview = nil
    gesture = .idle
    store.preview = nil
  }

  static func document(
    _ document: AnnotationDocument, adding annotation: Annotation
  ) -> AnnotationDocument {
    var copy = document
    copy.add(annotation)
    return copy
  }

  static func document(
    _ document: AnnotationDocument, replacing annotation: Annotation
  ) -> AnnotationDocument {
    var copy = document
    copy.update(annotation)
    return copy
  }
}
