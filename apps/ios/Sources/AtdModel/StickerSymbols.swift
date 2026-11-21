/// The symbols Atd draws in ink: what a command, mini app or automation wears on its sticker and
/// on its activity's tile, an automation's steps, and the rows of 我的. Each is an SF Symbol name,
/// which Atd saves and the system surfaces draw (the keyboard, the share sheet, Control Center,
/// Siri), paired with the Lucide glyph Atd draws in its place, as the prototype does.
/// The built-in items use them and a model drafting a command or a mini app picks from them, so
/// every sticker has its glyph; a symbol outside the list, saved before it existed, is drawn as
/// the SF Symbol itself.
public enum StickerSymbols {
  /// Every symbol with its glyph, in the order the drafting prompts list them.
  public static let all: [(symbol: String, glyph: String)] = [
    // The built-in commands.
    ("sparkles", "sparkles"),
    ("arrowshape.turn.up.left", "reply"),
    ("translate", "languages"),
    ("scissors", "scissors"),
    ("calendar.badge.plus", "calendar-plus"),
    ("receipt", "receipt-text"),
    ("sunrise", "sunrise"),
    ("rectangle.and.pencil.and.ellipsis", "presentation"),
    // 随手问 on the commands widget.
    ("waveform", "audio-lines"),
    // The built-in mini apps, and what a mini app wears without a usable symbol.
    ("wallet.bifold", "wallet"),
    ("drop", "glass-water"),
    ("tent", "tent"),
    ("square.grid.2x2", "layout-grid"),
    // The built-in automations, their triggers and their steps, and a run whose automation is gone.
    ("house", "house"),
    ("building.2", "building-2"),
    ("car", "car"),
    ("sensor.tag.radiowaves.forward", "nfc"),
    ("moon", "moon"),
    ("mappin.and.ellipse", "map-pin"),
    ("figure.walk", "footprints"),
    ("alarm", "alarm-clock"),
    ("battery.100percent.bolt", "battery-charging"),
    ("clock", "clock"),
    ("calendar", "calendar"),
    ("list.bullet.rectangle", "list"),
    ("message", "message-circle"),
    ("timer", "timer"),
    ("wand.and.sparkles", "wand-sparkles"),
    ("flowchart", "workflow"),
    // The rows of 我的 and of a message step's recipients.
    ("key", "key-round"),
    ("keyboard", "keyboard"),
    ("person.crop.circle.badge.plus", "user-plus"),
    // Words, people and work.
    ("pencil", "pencil"),
    ("doc.text", "file-text"),
    ("text.alignleft", "align-left"),
    ("quote.opening", "quote"),
    ("checkmark.circle", "circle-check"),
    ("questionmark.circle", "circle-help"),
    ("lightbulb", "lightbulb"),
    ("envelope", "mail"),
    ("bubble.left.and.bubble.right", "messages-square"),
    ("phone", "phone"),
    ("person", "user"),
    ("person.2", "users"),
    ("chevron.left.forwardslash.chevron.right", "code"),
    ("checklist", "list-checks"),
    ("magnifyingglass", "search"),
    ("link", "link"),
    ("globe", "globe"),
    ("book", "book-open"),
    ("graduationcap", "graduation-cap"),
    ("briefcase", "briefcase"),
    ("chart.bar", "chart-column"),
    // Money, food, travel and pastimes.
    ("creditcard", "credit-card"),
    ("banknote", "banknote"),
    ("cart", "shopping-cart"),
    ("bag", "shopping-bag"),
    ("gift", "gift"),
    ("fork.knife", "utensils"),
    ("cup.and.saucer", "coffee"),
    ("airplane", "plane"),
    ("tram", "train-front"),
    ("map", "map"),
    ("camera", "camera"),
    ("photo", "image"),
    ("music.note", "music"),
    ("guitars", "guitar"),
    ("gamecontroller", "gamepad-2"),
    // Health, nature and marks.
    ("heart", "heart"),
    ("dumbbell", "dumbbell"),
    ("pills", "pill"),
    ("bed.double", "bed-double"),
    ("sun.max", "sun"),
    ("cloud", "cloud"),
    ("leaf", "leaf"),
    ("flame", "flame"),
    ("pawprint", "paw-print"),
    ("star", "star"),
    ("flag", "flag"),
    ("target", "target"),
    ("trophy", "trophy"),
    ("bell", "bell"),
    ("lock", "lock"),
    ("face.smiling", "smile"),
  ]

  /// Whether a drafted item may wear `symbol`.
  public static func contains(_ symbol: String) -> Bool {
    glyphs[symbol] != nil
  }

  /// The Lucide glyph the ink pages draw for `symbol`, or nil for a symbol outside the list.
  public static func glyph(for symbol: String) -> String? {
    glyphs[symbol]
  }

  /// The names a drafting prompt offers, separated by commas.
  public static var promptList: String {
    all.map(\.symbol).joined(separator: ", ")
  }

  private static let glyphs = Dictionary(uniqueKeysWithValues: all.map { ($0.symbol, $0.glyph) })
}
