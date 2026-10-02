import AppKit

/// The capsule both annotation bars are built on: a row of ``AnnotationToolbarButton``s on a
/// Liquid Glass capsule (`NSGlassEffectView`), in groups split by hairlines. The capsule's radius
/// is the buttons' radius plus the even ``padding``, so the outline and the circular buttons nest
/// concentrically. A divider shows only between visible groups, and the capsule shrinks to fit.
final class AnnotationGlassBar: NSView {
  /// The same on every side, so the capsule stays concentric with the circular buttons.
  static let padding: CGFloat = 6

  private let glass = NSGlassEffectView()
  private let stack = NSStackView()
  private let groups: [[NSView]]
  /// Each group's divider (none before the first group).
  private var dividers: [NSView?] = []

  init(groups: [[NSView]]) {
    self.groups = groups
    super.init(frame: .zero)
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = 2
    let inset = Self.padding
    stack.edgeInsets = NSEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
    for (index, group) in groups.enumerated() {
      var divider: NSView?
      if index > 0 {
        let line = Self.divider()
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(6, after: last) }
        stack.addArrangedSubview(line)
        stack.setCustomSpacing(6, after: line)
        divider = line
      }
      dividers.append(divider)
      for view in group { stack.addArrangedSubview(view) }
    }
    glass.contentView = stack
    addSubview(glass)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The bar's natural size; ``layout()`` makes the glass a capsule of that height.
  override var fittingSize: NSSize { stack.fittingSize }

  override func layout() {
    super.layout()
    glass.frame = bounds
    glass.cornerRadius = bounds.height / 2
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  /// Hides or shows group `index`; each divider then shows only with a visible group on both
  /// sides of it.
  func setGroup(_ index: Int, hidden: Bool) {
    for view in groups[index] { view.isHidden = hidden }
    var visibleBefore = false
    for (group, divider) in zip(groups, dividers) {
      let visible = group.contains { !$0.isHidden }
      divider?.isHidden = !(visible && visibleBefore)
      visibleBefore = visibleBefore || visible
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
