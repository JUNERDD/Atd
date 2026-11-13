import AppKit

/// The capsule both annotation bars are built on: a row of ``AnnotationToolbarButton``s on a glass
/// capsule (``NativeMaterialView``), in groups split by hairlines. The capsule's radius
/// is the buttons' radius plus the even ``padding``, so the outline and the circular buttons nest
/// concentrically. A divider shows only between visible groups, and the capsule shrinks to fit.
/// The glass is the shell's glass surface (``GlassSurface``), in the app's scheme: it never adapts
/// to what lies behind it, and its row stands on the panel's base fill, rounded like the capsule. Where the
/// material is macOS 15's, the owner says what it blurs (`blending`): the capture overlay's
/// toolbars blur the frozen screen under them within their window, every other capsule the
/// desktop behind its window.
///
/// The bar's own surface (anywhere but a control, including an ``AnnotationBarGrip``) moves it:
/// a drag reports ``Drag`` to the owner, which places the bars. A bar without ``onDrag`` (the
/// selection toolbar) stays put.
///
/// At rest the glass fills the bar. While it changes shape (``outline``) it takes another
/// outline inside the bar, and the row, kept at its rest size, rides centred in it and clipped
/// by it.
final class AnnotationGlassBar: NSView {
  /// A press on the bar's surface.
  enum Drag {
    /// A move starts.
    case began
    /// The pointer's travel since the press, in flipped points (y down) like the overlay's.
    case moved(CGVector)
    /// A double-click: the bars go back beside the selection.
    case reset
  }

  /// The same on every side, so the capsule stays concentric with the circular buttons.
  static let padding: CGFloat = 6

  /// The glass's outline while it changes shape (``SelectionToolbarMorph``), in the bar: the row
  /// keeps its rest size, centred in `rect` and scaled by `rowScale` about its middle, as opaque
  /// as `rowOpacity`, and the glass's content clips it to the outline.
  struct Outline {
    var rect: NSRect
    var rowScale: CGFloat
    var rowOpacity: CGFloat
  }

  var onDrag: ((Drag) -> Void)?
  /// The glass's outline while it changes shape; nil at rest, where the glass fills the bar.
  var outline: Outline? {
    didSet {
      place()
      // While the row is scaled, AppKit renders each control's layer again for the scale it shows
      // at, and coming back to rest keeps the last of those renderings, made for a scale a hair
      // off it: a thin glyph then looked thinner until the control next redrew.
      if outline == nil, oldValue != nil { redrawRow() }
    }
  }

  private let material: NativeMaterialView
  /// The glass's content: the surface fill, rounded as the glass is, with the row on it.
  private let surface = NSView()
  /// Clips the row to the glass while it changes shape, as the glass's outline moves on every
  /// frame, never animating on its own.
  private let clip: CALayer = {
    let clip = CALayer()
    clip.backgroundColor = NSColor.black.cgColor
    clip.cornerCurve = .continuous
    clip.actions = ["bounds": NSNull(), "position": NSNull(), "cornerRadius": NSNull()]
    return clip
  }()
  private let stack = NSStackView()
  private let groups: [[NSView]]
  private let dividerSpacing: (leading: CGFloat, trailing: CGFloat)
  /// Each group's divider (none before the first group).
  private var dividers: [NSView?] = []
  /// Where the press that is moving the bar went down, in screen coordinates. Travel is
  /// measured on screen, not in the window: the selection toolbar moves its own window while it
  /// is dragged, so a window-relative point would shift under the pointer with every move and
  /// make the drag jitter. (The capture overlay's window never moves, so both agree there.)
  private var dragStart: CGPoint?

  init(
    groups: [[NSView]], blending: NSVisualEffectView.BlendingMode,
    padding: CGFloat = AnnotationGlassBar.padding,
    dividerSpacing: (leading: CGFloat, trailing: CGFloat) = (6, 6)
  ) {
    self.groups = groups
    self.dividerSpacing = dividerSpacing
    material = NativeMaterialView(.capsule(blending))
    super.init(frame: .zero)
    // Its layer carries the row's scale while the glass changes shape.
    stack.wantsLayer = true
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 2
    let inset = padding
    stack.edgeInsets = NSEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    for (index, group) in groups.enumerated() {
      var divider: NSView?
      if index > 0 {
        let line = Self.divider()
        stack.addArrangedSubview(line)
        stack.setCustomSpacing(dividerSpacing.trailing, after: line)
        divider = line
      }
      dividers.append(divider)
      for view in group { stack.addArrangedSubview(view) }
    }
    refreshDividers()
    // At its content's size from the start, not zero: see ``restSize``.
    stack.setFrameSize(stack.fittingSize)
    surface.addSubview(stack)
    GlassSurface.attach(material, content: surface)
    addSubview(material.view)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The bar's natural size; ``layout()`` makes the material a capsule of that height.
  override var fittingSize: NSSize { stack.fittingSize }

  override func layout() {
    super.layout()
    place()
  }

  /// Lays the glass and the row out as ``outline`` has them.
  private func place() {
    let glass = outline?.rect ?? bounds
    material.view.frame = glass
    let radius = min(glass.width, glass.height) / 2
    GlassSurface.shape(material, content: surface, cornerRadius: radius)
    // A mask rather than `masksToBounds`, which AppKit takes for a view that clips: it would then
    // draw only the part of each control inside the glass, and the row scaled into it would show
    // the rest undrawn for a frame or two.
    clip.frame = NSRect(origin: .zero, size: glass.size)
    clip.cornerRadius = radius
    surface.layer?.mask = outline == nil ? nil : clip
    // At its rest size whatever the glass's, so a change of shape never lays the row out again.
    let rest = restSize
    stack.frame = NSRect(
      x: (glass.width - rest.width) / 2, y: (glass.height - rest.height) / 2,
      width: rest.width, height: rest.height)
    stack.alphaValue = bounds.isEmpty ? 0 : (outline?.rowOpacity ?? 1)
    // The controls scale on the row's own layer: on the surface's, the sublayer transform would
    // scale its mask too, and the fill with it. A sublayer transform acts about the layer's anchor
    // point, which AppKit puts at a view layer's origin, so the row's middle is measured from there.
    guard let layer = stack.layer else { return }
    let scale = outline?.rowScale ?? 1
    let pivot = CGPoint(
      x: rest.width * (0.5 - layer.anchorPoint.x), y: rest.height * (0.5 - layer.anchorPoint.y))
    var transform = CATransform3DMakeTranslation(pivot.x, pivot.y, 0)
    transform = CATransform3DScale(transform, scale, scale, 1)
    layer.sublayerTransform = CATransform3DTranslate(transform, -pivot.x, -pivot.y, 0)
  }

  /// The row's size at rest: the bar's, or, before its owner first sizes it (a host may lay it
  /// out at zero first), the row's own, unseen. The row never stands smaller than its controls:
  /// Auto Layout would break their fixed sizes to fit it, and log each one it broke.
  private var restSize: NSSize { bounds.isEmpty ? stack.fittingSize : bounds.size }

  /// Keeps the glass, its fill and the controls on it in the dark scheme whatever the app's is,
  /// for a bar standing over a dark backdrop, as the lightbox's own bars do (the long
  /// screenshot's annotate mode). The shell's glass owner keeps it so
  /// (``GlassSurface/pinDark(_:)``).
  func pinDark() { GlassSurface.pinDark(material) }

  /// Has the row and every control on it drawn again.
  private func redrawRow() {
    var views: [NSView] = [stack]
    while let view = views.popLast() {
      view.needsDisplay = true
      views += view.subviews
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Moving

  /// Taken here rather than passed up, so a press between the controls never reaches the
  /// overlay under the bar, where it would start a new selection.
  override func mouseDown(with event: NSEvent) {
    guard let onDrag else { return }
    guard event.clickCount < 2 else {
      onDrag(.reset)
      return
    }
    dragStart = NSEvent.mouseLocation
    onDrag(.began)
    PointerRole.grabbing.cursor.set()
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragStart else { return }
    // The pointer now, which is never older than the event being handled.
    let point = NSEvent.mouseLocation
    onDrag?(.moved(CGVector(dx: point.x - dragStart.x, dy: dragStart.y - point.y)))
    PointerRole.grabbing.cursor.set()
  }

  override func mouseUp(with event: NSEvent) {
    guard dragStart != nil else { return }
    dragStart = nil
    PointerRole.grab.cursor.set()
  }

  /// Hides or shows group `index`; each divider then shows only with a visible group on both
  /// sides of it.
  func setGroup(_ index: Int, hidden: Bool) {
    for view in groups[index] { view.isHidden = hidden }
    refreshDividers()
  }

  /// Hides or shows one control `view` inside a group, keeping divider visibility and pre-divider
  /// spacing aligned with the group's last visible control.
  func setHidden(_ hidden: Bool, for view: NSView) {
    guard view.isHidden != hidden else { return }
    view.isHidden = hidden
    refreshDividers()
  }

  /// Updates each divider's visibility and puts ``dividerSpacing.leading`` after the last visible
  /// view preceding each visible divider (default spacing everywhere else in a group).
  private func refreshDividers() {
    var previousLast: NSView?
    for (group, divider) in zip(groups, dividers) {
      let lastVisible = group.last { !$0.isHidden }
      let showsDivider = lastVisible != nil && previousLast != nil
      divider?.isHidden = !showsDivider
      if showsDivider, let previousLast {
        stack.setCustomSpacing(dividerSpacing.leading, after: previousLast)
      }
      for view in group {
        stack.setCustomSpacing(NSStackView.useDefaultSpacing, after: view)
      }
      if lastVisible != nil { previousLast = lastVisible }
    }
  }

  /// A hairline between groups, as tall as a glyph.
  private static func divider() -> NSView {
    let line = NSBox()
    line.boxType = .separator
    line.translatesAutoresizingMaskIntoConstraints = false
    line.heightAnchor.constraint(equalToConstant: 16).isActive = true
    return line
  }
}

/// The handle at the toolbar's leading edge that shows the bar can be dragged. A press on it
/// goes up the responder chain to the bar, which moves; the glyph inside, a control that would
/// keep the press, is never hit.
final class AnnotationBarGrip: NSView {
  private let glyph = NSImageView()

  var image: NSImage? {
    get { glyph.image }
    set { glyph.image = newValue }
  }

  init() {
    super.init(frame: CGRect(x: 0, y: 0, width: 16, height: AnnotationToolbarButton.side))
    glyph.imageScaling = .scaleNone
    // The toolbar text's colour, like every glyph on the bar.
    glyph.contentTintColor = .labelColor
    glyph.frame = bounds
    glyph.autoresizingMask = [.width, .height]
    glyph.setAccessibilityElement(false)
    addSubview(glyph)
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: bounds.width),
      heightAnchor.constraint(equalToConstant: bounds.height),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    super.hitTest(point) == nil ? nil : self
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
