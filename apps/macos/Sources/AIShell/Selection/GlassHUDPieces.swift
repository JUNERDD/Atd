import AICore
import AppKit

/// The parts the glass status HUD (``GlassHUD``) builds its rows from, in the selection toolbar's
/// vocabulary: the grip, the app's monochrome mark (the menu bar's) or the island's activity
/// indicator, text in the toolbar's label type, a hint with its keys as keycaps (the page's
/// `Kbd`: 20 pt tall, 12 pt medium on a muted fill, fully rounded), and round glyph buttons such
/// as close. The command island
/// (``IslandController``) draws the same vocabulary in SwiftUI and shares ``keysMarker`` and
/// ``keycapHeight``.
enum GlassHUDPieces {
  /// Stands in for the keys while a hint is translated, then splits it around them.
  static let keysMarker = "\u{2063}"
  static let keycapHeight: CGFloat = 20
  /// The 16 pt glyph slot of the mark.
  static let glyphSide: CGFloat = 16

  /// The drag handle that leads a movable HUD's row.
  static func grip() -> AnnotationBarGrip {
    let grip = AnnotationBarGrip()
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = ShellStrings.shared.text(.captureToolbarMove)
    return grip
  }

  /// The round × button, named `label` for VoiceOver and its tooltip.
  static func close(label: String, target: AnyObject, action: Selector) -> AnnotationToolbarButton {
    button(glyph: AnnotationIcons.cancel, label: label, target: target, action: action)
  }

  /// A round button showing the Lucide glyph `glyph`, named `label` for VoiceOver and its tooltip.
  static func button(glyph: String, label: String, target: AnyObject, action: Selector)
    -> AnnotationToolbarButton
  {
    let button = AnnotationToolbarButton(selection: nil, action: action)
    button.image = AnnotationIcons.glyph(glyph, label: label)
    button.setAccessibilityLabel(label)
    button.toolTip = label
    button.target = target
    return button
  }

  /// The island's activity indicator in the glyph slot, for a status that is under way.
  static func activity() -> NSView {
    let view = IslandSpinnerView()
    view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      view.widthAnchor.constraint(equalToConstant: glyphSide),
      view.heightAnchor.constraint(equalToConstant: glyphSide),
    ])
    return view
  }

  /// The menu bar's template mark, tinted like the text beside it.
  static func mark() -> NSView {
    let image = (NSImage(named: "idleTemplate")?.copy() as? NSImage) ?? NSImage()
    image.size = NSSize(width: glyphSide, height: glyphSide)
    image.isTemplate = true
    let view = NSImageView(image: image)
    view.contentTintColor = .labelColor
    view.setContentHuggingPriority(.required, for: .horizontal)
    return view
  }

  /// How wide a title that shows user data (a command name, target names) grows before it
  /// tail-truncates.
  static let titleLimit: CGFloat = 220

  /// One line of text: `primary` in the toolbar's label type, else secondary 12 pt.
  static func text(_ string: String, primary: Bool) -> NSTextField {
    let field = NSTextField(labelWithString: string)
    field.font = primary ? AnnotationToolbarButton.Label.font : .systemFont(ofSize: 12)
    field.textColor = primary ? .labelColor : .secondaryLabelColor
    field.lineBreakMode = .byClipping
    return field
  }

  /// `hint` (translated around ``keysMarker``) in secondary text with `keys` as keycaps
  /// wherever the language puts them, and what VoiceOver reads for it.
  static func sentence(_ hint: String, keys: [String]) -> (view: NSView, label: String) {
    let parts = hint.components(separatedBy: keysMarker)
    var views: [NSView] = []
    for (index, part) in parts.enumerated() {
      let trimmed = part.trimmingCharacters(in: .whitespaces)
      if !trimmed.isEmpty { views.append(text(trimmed, primary: false)) }
      if index < parts.count - 1 { views.append(contentsOf: keys.map(keycap)) }
    }
    let stack = NSStackView(views: views)
    stack.spacing = 4
    return (stack, hint.replacingOccurrences(of: keysMarker, with: keys.joined()))
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
      layer?.cornerRadius = GlassHUDPieces.keycapHeight / 2
      layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(0.08).cgColor
    }
  }
}
