import Foundation

/// What a key does.
enum KeyAction: Equatable, Hashable {
  /// Types a character; letters are lowercase here and shift applies when pressed.
  case character(String)
  case shift
  case delete
  case layer(KeyLayer)
  /// The system's next-keyboard key, drawn only when `needsInputModeSwitchKey` asks for it.
  case globe
  case space
  case enter
}

enum KeyLayer: Equatable, Hashable {
  case letters
  case numbers
  case symbols
}

/// One key of a row, on a grid of 20 columns where a letter takes 2 (as in the prototype).
struct KeySpec: Equatable {
  var action: KeyAction
  var span: Int
  /// Empty columns before it: the middle letter row starts half a key in.
  var offset = 0
  /// Drawn in the darker function color.
  var isFunction = false
  /// Space between it and its neighbor, so shift and delete stand apart from the letters.
  var leadingInset: CGFloat = 0
  var trailingInset: CGFloat = 0
}

enum KeyLayout {
  static let columns = 20

  /// The four rows of a layer: three of characters, then 123 · (globe) · ， · space · 。 · return.
  static func rows(_ layer: KeyLayer, globe: Bool) -> [[KeySpec]] {
    let (first, second, third) = characters(layer)
    var rows = [keys(first), keys(second), [thirdRowStart(layer)] + keys(third) + [delete]]
    if layer == .letters { rows[1][0].offset = 1 }
    rows.append(bottomRow(layer, globe: globe))
    return rows
  }

  private static func characters(_ layer: KeyLayer) -> (String, String, String) {
    switch layer {
    case .letters: ("qwertyuiop", "asdfghjkl", "zxcvbnm")
    case .numbers: ("1234567890", "-/：；（）¥@“”", "。，、？！～…")
    case .symbols: ("【】｛｝#%^*+=", "_—\\|～《》$&·", ".,?!'\"…")
    }
  }

  private static func keys(_ characters: String) -> [KeySpec] {
    characters.map { KeySpec(action: .character(String($0)), span: 2) }
  }

  private static func thirdRowStart(_ layer: KeyLayer) -> KeySpec {
    let action: KeyAction =
      switch layer {
      case .letters: .shift
      case .numbers: .layer(.symbols)
      case .symbols: .layer(.numbers)
      }
    return KeySpec(action: action, span: 3, isFunction: true, trailingInset: 8)
  }

  private static var delete: KeySpec {
    KeySpec(action: .delete, span: 3, isFunction: true, leadingInset: 8)
  }

  private static func bottomRow(_ layer: KeyLayer, globe: Bool) -> [KeySpec] {
    var row = [
      KeySpec(action: .layer(layer == .letters ? .numbers : .letters), span: 3, isFunction: true)
    ]
    if globe { row.append(KeySpec(action: .globe, span: 2, isFunction: true)) }
    row += [
      KeySpec(action: .character("，"), span: 2, isFunction: true),
      KeySpec(action: .space, span: globe ? 7 : 9),
      KeySpec(action: .character("。"), span: 2, isFunction: true),
      KeySpec(action: .enter, span: 4, isFunction: true),
    ]
    return row
  }
}
