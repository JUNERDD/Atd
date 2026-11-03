import CoreGraphics
import Foundation

/// Which side of the selection the toolbar takes and what it is centered on (`toolbar.set`'s
/// `position`). The small icon, and the toolbar it grows into, always take ``pointer``.
public enum SelectionToolbarPosition: Equatable, Sendable {
  /// Centered on the pointer, outside the selection on the side the pointer ended on: below a
  /// selection of several lines when the pointer is on its last line (a downward drag), above it
  /// otherwise (one line, an upward drag, a triple click in the middle). A side whose frame would
  /// cover the pointer (one that ended outside the selection) yields to the other when that fits.
  case pointer
  /// Centered on the selection, above it.
  case above
  /// Centered on the selection, below it.
  case below
}

/// Where the selection toolbar goes, in Cocoa global points (origin bottom-left of the primary
/// display, y up; displays left of or below it have negative origins). The toolbar sits ``gap``
/// outside the selection on the side its ``SelectionToolbarPosition`` prefers, or on the other
/// when there is no room there, centered on the selection or the pointer as the position says;
/// and inside the display's work area by ``margin`` in any case. A selection the app reports no
/// bounds for, or bounds on no display (some apps answer zeros), gives way to the pointer, taken
/// as one text line around it. A selection too tall for either side (a long passage) does the
/// same, so the toolbar never covers the middle of it.
public enum SelectionToolbarPlacement {
  public static let gap = 8.0
  public static let margin = 8.0
  /// Half the height of the text line assumed around the pointer, which is also the line height
  /// the ``SelectionToolbarPosition/pointer`` rule measures a selection's lines by.
  public static let pointerLineHalfHeight = 10.0

  /// A display: its whole frame, which decides where a point is, and its work area
  /// (`NSScreen.visibleFrame`), which the toolbar stays inside.
  public struct Display: Equatable, Sendable {
    public let frame: ScreenRect
    public let workArea: ScreenRect

    public init(frame: ScreenRect, workArea: ScreenRect) {
      self.frame = frame
      self.workArea = workArea
    }
  }

  private enum Side { case above, below }

  /// The toolbar's frame for a selection at `selection` (Cocoa points, nil when unknown) and
  /// the pointer at `pointer`, placed as `position` says; nil without displays (a transient
  /// state while they rearrange).
  public static func frame(
    size: WindowSize, selection: ScreenRect?, pointer: CGPoint,
    position: SelectionToolbarPosition, displays: [Display]
  ) -> ScreenRect? {
    guard
      let index = DisplaySelection.index(
        nearestTo: pointer.x, pointer.y, in: displays.map(\.frame))
    else { return nil }
    let pointerDisplay = displays[index].workArea
    let pointerLine = ScreenRect(
      x: pointer.x, y: pointer.y - pointerLineHalfHeight, width: 0,
      height: pointerLineHalfHeight * 2)
    if let selection, selection.height > 0, selection.width >= 0,
      let display = displays.first(where: {
        $0.frame.contains(
          x: selection.x + selection.width / 2, y: selection.y + selection.height / 2)
      })
    {
      let area = display.workArea
      let center = position == .pointer ? pointer.x : selection.x + selection.width / 2
      let x = horizontalPosition(size: size, center: center, within: area)
      let avoided = position == .pointer ? pointer : nil
      if let y = verticalPosition(
        size: size, anchor: selection, sides: sides(position, selection, pointer),
        within: area, x: x, avoiding: avoided)
      {
        return ScreenRect(x: x, y: y, width: size.width, height: size.height)
      }
    }
    // The pointer's line, which every position tries in its own order (`pointer` above first).
    let sides: [Side] = position == .below ? [.below, .above] : [.above, .below]
    let x = horizontalPosition(size: size, center: pointer.x, within: pointerDisplay)
    let y =
      verticalPosition(
        size: size, anchor: pointerLine, sides: sides, within: pointerDisplay, x: x,
        avoiding: nil)
      ?? clamp(
        bottom(of: sides[0], size: size, anchor: pointerLine), pointerDisplay.y + margin,
        pointerDisplay.maxY - margin - size.height)
    return ScreenRect(x: x, y: y, width: size.width, height: size.height)
  }

  /// The small icon's frame, `side` points square: where the ``SelectionToolbarPosition/pointer``
  /// rule puts a surface as wide as the icon and as tall as the toolbar (`toolbarHeight`), at that
  /// slot's edge nearest the pointer, so ``gap`` outside the selection. Measuring the slot by the
  /// toolbar's height keeps the icon on the side the toolbar it grows into takes by the same
  /// rule, even within a few points of the work area's edge, so the icon lies inside that
  /// toolbar's frame; and since that slot never covers the pointer where it can help it, neither
  /// does the icon.
  public static func iconFrame(
    side: Double, toolbarHeight: Double, selection: ScreenRect?, pointer: CGPoint,
    displays: [Display]
  ) -> ScreenRect? {
    guard
      let slot = frame(
        size: WindowSize(width: side, height: toolbarHeight), selection: selection,
        pointer: pointer, position: .pointer, displays: displays)
    else { return nil }
    let y = pointer.y <= slot.y + slot.height / 2 ? slot.y : slot.maxY - side
    return ScreenRect(x: slot.x, y: y, width: side, height: side)
  }

  /// The frame `toolbar` takes round the small icon placed at `icon`, once the icon has been
  /// dragged to `moved`: carried along with it, then kept ``margin`` inside the work area of the
  /// display that holds the icon and round the icon itself, so the toolbar still grows out of the
  /// icon where it was dropped.
  public static func frame(
    _ toolbar: ScreenRect, aroundIcon icon: ScreenRect, movedTo moved: ScreenRect,
    displays: [Display]
  ) -> ScreenRect {
    var frame = toolbar
    frame.x += moved.x - icon.x
    frame.y += moved.y - icon.y
    if let index = DisplaySelection.index(
      nearestTo: moved.x + moved.width / 2, moved.y + moved.height / 2,
      in: displays.map(\.frame))
    {
      let area = displays[index].workArea
      frame.x = clamp(frame.x, area.x + margin, area.maxX - margin - frame.width)
      frame.y = clamp(frame.y, area.y + margin, area.maxY - margin - frame.height)
    }
    frame.x = clamp(frame.x, moved.maxX - frame.width, moved.x)
    frame.y = clamp(frame.y, moved.maxY - frame.height, moved.y)
    return frame
  }

  /// The sides `position` tries for `selection`, in order.
  private static func sides(
    _ position: SelectionToolbarPosition, _ selection: ScreenRect, _ pointer: CGPoint
  ) -> [Side] {
    switch position {
    case .above: return [.above, .below]
    case .below: return [.below, .above]
    case .pointer:
      let line = pointerLineHalfHeight * 2
      let multiLine = selection.height > line * 1.5
      let onLastLine = pointer.y <= selection.y + line
      return multiLine && onLastLine ? [.below, .above] : [.above, .below]
    }
  }

  /// The first of `sides` the toolbar fits on (`x` its left edge), passing over one whose frame
  /// would cover `avoiding` while a later one fits; nil when it fits on neither.
  private static func verticalPosition(
    size: WindowSize, anchor: ScreenRect, sides: [Side], within area: ScreenRect, x: Double,
    avoiding pointer: CGPoint?
  ) -> Double? {
    let fitting = sides.map { bottom(of: $0, size: size, anchor: anchor) }.filter {
      $0 >= area.y + margin && $0 + size.height <= area.maxY - margin
    }
    guard let pointer else { return fitting.first }
    return fitting.first {
      !ScreenRect(x: x, y: $0, width: size.width, height: size.height)
        .contains(x: pointer.x, y: pointer.y)
    } ?? fitting.first
  }

  /// The toolbar's bottom ``gap`` outside `anchor` on `side`.
  private static func bottom(of side: Side, size: WindowSize, anchor: ScreenRect) -> Double {
    switch side {
    case .above: anchor.maxY + gap
    case .below: anchor.y - gap - size.height
    }
  }

  /// The left edge that centers the toolbar on `center`, kept `margin` inside the work area.
  private static func horizontalPosition(size: WindowSize, center: Double, within area: ScreenRect)
    -> Double
  {
    clamp(center - size.width / 2, area.x + margin, area.maxX - margin - size.width)
  }

  /// `value` within `lower...upper`; `lower` wins when the range is empty (a display narrower
  /// or shorter than the toolbar keeps its left or bottom margin).
  private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
    max(lower, min(value, upper))
  }
}

/// The selection toolbar's row (visual spec, contracts §6): a 4 pt padded glass capsule with
/// 2 pt between items, Ask Atd first, then one button per command while the toolbar stays
/// within ``maxWidth``, then a More button for the rest.
public enum SelectionToolbarLayout {
  public static let maxWidth = 420.0
  public static let padding = 4.0
  public static let gap = 2.0
  /// The square More button.
  public static let moreWidth = 28.0
  /// The drag handle that leads the row, as the capture toolbar's.
  public static let gripWidth = 16.0

  /// How many commands, in order, get a button of their own after the grip and Ask; the others
  /// go in More. Widths are the buttons' as measured; `endingWidths`, where given, are each
  /// command's when it ends the row with no More after it (a split button's chevron widens there).
  public static func visibleCommandCount(
    askWidth: Double, commandWidths: [Double], endingWidths: [Double]? = nil
  ) -> Int {
    func width(_ count: Int, more: Bool) -> Double {
      var commands = Array(commandWidths.prefix(count))
      if !more, count > 0, let ending = endingWidths?[count - 1] { commands[count - 1] = ending }
      let items = [gripWidth, askWidth] + commands + (more ? [moreWidth] : [])
      return padding * 2 + items.reduce(0, +) + gap * Double(items.count - 1)
    }
    if width(commandWidths.count, more: false) <= maxWidth { return commandWidths.count }
    var count = commandWidths.count - 1
    while count > 0, width(count, more: true) > maxWidth { count -= 1 }
    return max(count, 0)
  }
}
