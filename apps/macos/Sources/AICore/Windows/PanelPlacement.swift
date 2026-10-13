/// Where a summon shows the task panel (`window.setPlacement`), always on the display under the
/// cursor: docked in the bottom-right corner of its work area (the default), centered in it, or
/// where the user last left the panel on that display, centered until they have moved it there.
public enum PanelPlacement: String, CaseIterable, Equatable, Sendable {
  case bottomRight
  case center
  case lastPosition
}

/// The point of a work area a summon placed the panel against, which the panel keeps to while it
/// stays there (``PanelGeometry/follow(_:anchor:workArea:)``).
public struct PanelAnchor: Equatable, Sendable {
  public enum Point: Equatable, Sendable {
    case bottomRight
    case center
  }

  public var point: Point
  public var workArea: ScreenRect

  public init(point: Point, workArea: ScreenRect) {
    self.point = point
    self.workArea = workArea
  }

  /// The panel's frame at this anchor for a panel of `size`, under the same size rules.
  public func frame(size: WindowSize) -> ScreenRect {
    switch point {
    case .bottomRight: PanelGeometry.dockedFrame(in: workArea, size: size)
    case .center: PanelGeometry.centeredFrame(in: workArea, size: size)
    }
  }
}

/// Where the user left the panel on one display: the distance of its top-left corner from the
/// top-left corner of that display's work area, in points. The top edge is kept rather than the
/// origin so the title bar comes back where it was whatever height the panel has by then.
public struct PanelOffset: Codable, Equatable, Sendable {
  public var left: Double
  public var top: Double

  public init(left: Double, top: Double) {
    self.left = left
    self.top = top
  }
}

extension PanelGeometry {
  /// Centers the panel in the work area, sized as ``dockedFrame(in:size:)`` sizes it.
  public static func centeredFrame(in workArea: ScreenRect, size: WindowSize = defaultSize)
    -> ScreenRect
  {
    let (fitted, _) = fit(size, in: workArea)
    return ScreenRect(
      x: workArea.x + ((workArea.width - fitted.width) / 2).rounded(.down),
      y: workArea.y + ((workArea.height - fitted.height) / 2).rounded(.down),
      width: fitted.width,
      height: fitted.height)
  }

  /// Where `frame` sits in the work area of the display holding it, to restore it there later.
  public static func offset(of frame: ScreenRect, in workArea: ScreenRect) -> PanelOffset {
    PanelOffset(left: frame.x - workArea.x, top: workArea.maxY - frame.maxY)
  }

  /// A panel of `size` back at a remembered offset. The display may have shrunk or its menu bar
  /// or Dock grown since, so the panel is kept at least the minimum, at most the work area, and
  /// moved fully inside it; no margin is added, since the user chose the place.
  public static func restoredFrame(
    _ offset: PanelOffset, size: WindowSize, in workArea: ScreenRect
  ) -> ScreenRect {
    let minimum = minimumSize(in: workArea)
    let width = max(minimum.width, size.width)
    let height = max(minimum.height, size.height)
    let frame = ScreenRect(
      x: workArea.x + offset.left, y: workArea.maxY - offset.top - height,
      width: width, height: height)
    return constrain(frame, to: workArea)
  }

  /// The frame a summon shows the panel at in the work area of the display under the cursor, and
  /// the anchor it follows there afterwards (nil for a remembered place, which only stays
  /// inside). `remembered` is where the user last left the panel on that display, if anywhere.
  public static func summonFrame(
    _ placement: PanelPlacement, in workArea: ScreenRect, size: WindowSize,
    remembered: PanelOffset?
  ) -> (frame: ScreenRect, anchor: PanelAnchor?) {
    let point: PanelAnchor.Point
    switch (placement, remembered) {
    case (.lastPosition, let offset?):
      return (restoredFrame(offset, size: size, in: workArea), nil)
    case (.bottomRight, _): point = .bottomRight
    case (.center, _), (.lastPosition, nil): point = .center
    }
    let anchor = PanelAnchor(point: point, workArea: workArea)
    return (anchor.frame(size: size), anchor)
  }
}
