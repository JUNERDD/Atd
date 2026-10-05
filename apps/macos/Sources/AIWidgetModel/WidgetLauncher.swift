import Foundation

/// The "My Apps" launcher's grid in one widget family, like a page of a Home Screen: small shows
/// four icons two by two; medium and large put each app's name under its icon, four across, in
/// two and four rows. `iconSide` is the largest an icon is drawn, chosen for the system sizes
/// (about 170 × 170, 364 × 170 and 364 × 382 pt, inside 11–16 pt margins) so tiles keep clear
/// gaps and every tile stays far larger than the Mac's 28 pt click target; a smaller widget
/// shrinks the icons instead of clipping them.
public struct WidgetLauncherLayout: Equatable, Sendable {
  public let columns: Int
  public let rows: Int
  /// Points.
  public let iconSide: Double
  public let showsNames: Bool

  public init(family: WidgetFamily) {
    switch family {
    case .systemSmall: (columns, rows, iconSide, showsNames) = (2, 2, 56, false)
    case .systemMedium: (columns, rows, iconSide, showsNames) = (4, 2, 42, true)
    case .systemLarge: (columns, rows, iconSide, showsNames) = (4, 4, 54, true)
    }
  }

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
