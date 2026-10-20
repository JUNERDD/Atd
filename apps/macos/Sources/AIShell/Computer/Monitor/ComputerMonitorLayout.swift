import AppKit

/// The monitor's geometry: where the grid's tiles, a tile's picture and the focused picture go,
/// and which tile keyboard focus moves to. Pure functions of the sizes the content view measures,
/// so the grid, the focus transition and the arrow keys agree on one arrangement.
enum ComputerMonitorLayout {
  /// Around the grid; its top edge starts below the toolbar (the content's safe area).
  static let outerInset: CGFloat = 16
  /// Between tiles, across and down.
  static let gap: CGFloat = 12
  /// Between a picture and its caption row.
  static let captionGap: CGFloat = 8
  static let captionHeight: CGFloat = 20
  /// Below this the rows stop sharing the visible height and the grid scrolls instead.
  static let minimumPictureHeight: CGFloat = 160
  /// The content width from which two or more sources share two columns.
  static let twoColumnWidth: CGFloat = 560
  /// Around the focused picture, below the toolbar.
  static let focusInset: CGFloat = 12
  /// Every picture's continuous corner radius, in the grid and in focus.
  static let cornerRadius: CGFloat = 12
  /// The Enlarge control's inset from its picture's top-trailing corner.
  static let controlInset: CGFloat = 8

  /// The grid in its scrolling document: the tiles' frames in source order, row by row, and the
  /// document's height, taller than the visible height only when the pictures would otherwise
  /// fall under ``minimumPictureHeight``.
  struct Grid {
    let columns: Int
    let tiles: [CGRect]
    let height: CGFloat
  }

  /// One source fills the area; two to four share two columns once the content is wide enough.
  static func columns(count: Int, width: CGFloat) -> Int {
    count > 1 && width >= twoColumnWidth ? 2 : 1
  }

  /// Lays `count` tiles out in a document `width` wide whose visible part below the toolbar is
  /// `height` tall. The rows share that height evenly.
  static func grid(count: Int, width: CGFloat, height: CGFloat) -> Grid {
    let columns = columns(count: count, width: width)
    let rows = max(1, (count + columns - 1) / columns)
    let caption = captionGap + captionHeight
    let tileWidth = max(
      0, (width - outerInset * 2 - gap * CGFloat(columns - 1)) / CGFloat(columns))
    let shared = (height - outerInset * 2 - gap * CGFloat(rows - 1)) / CGFloat(rows)
    let tileHeight = max(minimumPictureHeight + caption, shared)
    let tiles = (0..<count).map { index in
      CGRect(
        x: outerInset + CGFloat(index % columns) * (tileWidth + gap),
        y: outerInset + CGFloat(index / columns) * (tileHeight + gap),
        width: tileWidth, height: tileHeight)
    }
    let needed = outerInset * 2 + CGFloat(rows) * tileHeight + gap * CGFloat(rows - 1)
    return Grid(columns: columns, tiles: tiles, height: max(height, needed))
  }

  /// A tile's picture, above its caption row, in the tile's flipped coordinates.
  static func picture(inTile bounds: CGRect) -> CGRect {
    CGRect(
      x: 0, y: 0, width: bounds.width,
      height: max(0, bounds.height - captionGap - captionHeight))
  }

  /// A tile's caption row, below its picture.
  static func caption(inTile bounds: CGRect) -> CGRect {
    CGRect(
      x: 0, y: max(0, bounds.height - captionHeight), width: bounds.width, height: captionHeight)
  }

  /// The focused picture in the content's flipped coordinates: the area below the toolbar
  /// (`safeArea`), inset on every side.
  static func focus(in bounds: CGRect, safeArea: NSEdgeInsets) -> CGRect {
    CGRect(
      x: bounds.minX + safeArea.left + focusInset,
      y: bounds.minY + safeArea.top + focusInset,
      width: max(0, bounds.width - safeArea.left - safeArea.right - focusInset * 2),
      height: max(0, bounds.height - safeArea.top - safeArea.bottom - focusInset * 2))
  }

  /// The direction an arrow key moves tile focus.
  enum Direction {
    case left, right, up, down
  }

  /// The tile keyboard focus moves to from `index`, nil past the grid's ends. Left and right
  /// follow reading order, so they also walk a single column; up and down move a whole row.
  static func neighbor(of index: Int, _ direction: Direction, count: Int, columns: Int) -> Int? {
    let next =
      switch direction {
      case .left: index - 1
      case .right: index + 1
      case .up: index - columns
      case .down: index + columns
      }
    return (0..<count).contains(next) ? next : nil
  }

  /// `from` moved toward `to` by `progress`, 0 to 1.
  static func interpolate(_ from: CGRect, _ to: CGRect, _ progress: CGFloat) -> CGRect {
    func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * progress }
    return CGRect(
      x: mix(from.minX, to.minX), y: mix(from.minY, to.minY),
      width: mix(from.width, to.width), height: mix(from.height, to.height))
  }
}
