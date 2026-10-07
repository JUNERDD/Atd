import Foundation

/// The "My Apps" launcher's grid in one widget family, like a page of a Home Screen: small shows
/// four icons two by two; medium and large put each app's name under its icon, four across, in
/// two and four rows. `iconSide` is the largest an icon is drawn, chosen for the system sizes
/// (about 170 × 170, 364 × 170 and 364 × 382 pt, inside 11–16 pt margins) so tiles keep clear
/// gaps and every tile stays far larger than the Mac's 28 pt click target; a smaller widget
/// shrinks the icons instead of clipping them. A desktop pin's tile is a one-app layout of its own
/// (``pinTile``, ``pinTileMedium``).
public struct WidgetLauncherLayout: Equatable, Sendable {
  /// Where a tile puts the app's name: under its icon, as on a Home Screen, or beside it as a
  /// headline over the app's description, which needs a wide card to itself.
  public enum NamePlacement: Equatable, Sendable {
    case below
    case beside
  }

  public let columns: Int
  public let rows: Int
  /// Points.
  public let iconSide: Double
  public let showsNames: Bool
  public let namePlacement: NamePlacement

  public init(family: WidgetFamily) {
    switch family {
    case .systemSmall: (columns, rows, iconSide, showsNames) = (2, 2, 56, false)
    case .systemMedium: (columns, rows, iconSide, showsNames) = (4, 2, 42, true)
    case .systemLarge: (columns, rows, iconSide, showsNames) = (4, 4, 54, true)
    }
    namePlacement = .below
  }

  private init(
    columns: Int, rows: Int, iconSide: Double, showsNames: Bool, namePlacement: NamePlacement
  ) {
    self.columns = columns
    self.rows = rows
    self.iconSide = iconSide
    self.showsNames = showsNames
    self.namePlacement = namePlacement
  }

  /// A desktop pin's small tile, for an app without a widget or one shown as its icon, while the
  /// pin is narrow: the app's one icon, large, with its name under it, centred in the card.
  public static let pinTile = WidgetLauncherLayout(
    columns: 1, rows: 1, iconSide: 72, showsNames: true, namePlacement: .below)

  /// A desktop pin's medium tile, once the pin is wide enough: the same icon on the leading side,
  /// and beside it the name as a headline over as much of the app's description as the card's
  /// height holds. Both tiles draw the icon at one size, so one bitmap serves either.
  public static let pinTileMedium = WidgetLauncherLayout(
    columns: 1, rows: 1, iconSide: pinTile.iconSide, showsNames: true, namePlacement: .beside)

  /// Apps the family shows; the large grid holds ``WidgetContract/launcherMaxApps``, all the
  /// service lists.
  public var capacity: Int { columns * rows }

  /// The side, in pixels, of the bitmap the extension draws an icon into: the icon at the 2×
  /// scale of a Retina display.
  public var iconPixels: Int { Int((iconSide * 2).rounded(.up)) }
}

/// The byte checks the shell and the extension both apply to a launcher icon before anything
/// treats it as SVG. They parse nothing: the shell never parses or draws an app's icon, which an
/// agent wrote, and the sandboxed extension, which does, refuses what these refuse.
public enum WidgetLauncherIcon {
  /// At most ``WidgetContract/launcherIconMaxBytes``; text whose first character after an optional
  /// UTF-8 byte order mark and whitespace is `<`, so no other image format reaches the decoder; and
  /// no XML entity declaration, whose expansion could exhaust the extension.
  public static func accepts(_ data: Data) -> Bool {
    guard data.count <= WidgetContract.launcherIconMaxBytes else { return false }
    let start = data.starts(with: [0xEF, 0xBB, 0xBF]) ? data.dropFirst(3) : data[...]
    let whitespace: Set<UInt8> = [0x20, 0x09, 0x0A, 0x0D]
    guard start.first(where: { !whitespace.contains($0) }) == UInt8(ascii: "<") else {
      return false
    }
    return data.range(of: Data("<!ENTITY".utf8)) == nil
  }
}
