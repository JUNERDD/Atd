import AICore
import AppKit

/// What the status HUD (``SelectionToolbarHUD``) shows, in the selection toolbar's vocabulary:
/// the grip, the app's monochrome mark (the menu bar's), the state in the toolbar's label type,
/// the hint with its keys as keycaps (the page's `Kbd`: 20 pt tall, 12 pt medium on a muted fill,
/// fully rounded), and the close button. The off notice is the mark and the off state alone.
enum SelectionToolbarHUDContent {
  /// Stands in for the keys while the hint is translated, then splits it around them.
  private static let keysMarker = "\u{2063}"
  static let keycapHeight: CGFloat = 20

  /// The row for the glass bar, and what VoiceOver reads for it: `keys` as keycap symbols,
  /// `close` the close button.
  static func row(keys: [String], close: NSButton) -> (views: [NSView], label: String) {
    let strings = ShellStrings.shared
    let grip = AnnotationBarGrip()
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    let title = strings.text(.selectionHudOn)
    let status = NSStackView(views: [mark(), text(title, primary: true)])
    status.spacing = 6
    let hint = strings.text(.selectionHudHint, keysMarker)
    let body = NSStackView(views: [status, sentence(hint, keys: keys)])
    body.spacing = 12
    body.edgeInsets = NSEdgeInsets(top: 0, left: 2, bottom: 0, right: 4)
    let label = title + ", " + hint.replacingOccurrences(of: keysMarker, with: keys.joined())
    return ([grip, body, close], label)
  }

  /// The off notice's row, and what VoiceOver reads for it: nothing to move or close.
  static func offRow() -> (views: [NSView], label: String) {
    let title = ShellStrings.shared.text(.selectionHudOff)
    let status = NSStackView(views: [mark(), text(title, primary: true)])
    status.spacing = 6
    status.edgeInsets = NSEdgeInsets(top: 0, left: 8, bottom: 0, right: 10)
    status.heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side).isActive = true
    return ([status], title)
  }

  /// The menu bar's template mark, tinted like the text beside it.
  private static func mark() -> NSView {
    let image = (NSImage(named: "idleTemplate")?.copy() as? NSImage) ?? NSImage()
    image.size = NSSize(width: 16, height: 16)
    image.isTemplate = true
    let view = NSImageView(image: image)
    view.contentTintColor = .labelColor
    view.setContentHuggingPriority(.required, for: .horizontal)
    return view
  }

  private static func text(_ string: String, primary: Bool) -> NSTextField {
    let field = NSTextField(labelWithString: string)
    field.font = primary ? AnnotationToolbarButton.Label.font : .systemFont(ofSize: 12)
    field.textColor = primary ? .labelColor : .secondaryLabelColor
    field.lineBreakMode = .byClipping
    return field
  }

  /// The hint in secondary text with the keys as keycaps wherever the language puts them.
  private static func sentence(_ hint: String, keys: [String]) -> NSView {
    let parts = hint.components(separatedBy: keysMarker)
    var views: [NSView] = []
    for (index, part) in parts.enumerated() {
      let trimmed = part.trimmingCharacters(in: .whitespaces)
      if !trimmed.isEmpty { views.append(text(trimmed, primary: false)) }
      if index < parts.count - 1 { views.append(contentsOf: keys.map(keycap)) }
    }
    let stack = NSStackView(views: views)
    stack.spacing = 4
    return stack
  }

  /// One key as the page's `Kbd` draws it.
  private static func keycap(_ symbol: String) -> NSView {
    let field = NSTextField(labelWithString: symbol)
    field.font = .systemFont(ofSize: 12, weight: .medium)
    field.textColor = .secondaryLabelColor
    field.alignment = .center
    field.translatesAutoresizingMaskIntoConstraints = false
    let cap = Keycap()
    cap.translatesAutoresizingMaskIntoConstraints = false
    cap.addSubview(field)
    NSLayoutConstraint.activate([
      cap.heightAnchor.constraint(equalToConstant: keycapHeight),
      cap.widthAnchor.constraint(greaterThanOrEqualToConstant: keycapHeight),
      field.centerYAnchor.constraint(equalTo: cap.centerYAnchor),
      field.leadingAnchor.constraint(equalTo: cap.leadingAnchor, constant: 4),
      field.trailingAnchor.constraint(equalTo: cap.trailingAnchor, constant: -4),
    ])
    return cap
  }

  /// The keycap's muted fill, resolved again whenever the appearance changes.
  private final class Keycap: NSView {
    override var wantsUpdateLayer: Bool { true }

    override func updateLayer() {
      layer?.cornerRadius = SelectionToolbarHUDContent.keycapHeight / 2
      layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.08).cgColor
    }
  }
}
