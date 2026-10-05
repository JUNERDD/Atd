import AICore
import AIWidgetModel
import AIWidgetRender
import AppKit

/// How big each pin is, and what its size shows (decision D5 v1.6). A pin resizes freely within
/// the sizes its layouts handle well, one range per family its widget declares
/// (``WidgetCard/pinRange(of:)``) or the tile's two (``WidgetCard/tileRange(of:)``), and shows the
/// largest of those families whose range holds its size, laid out at that size, never scaled.
/// That family is the one the pin reports, so the service renders it as for any widget. A pin
/// without a size of its own, new or set from the menu, has its family's.
extension DesktopPins {
  /// The families `face` can take, smallest first: those its widget declares, or a tile's two.
  /// Without the app's declarations (a new build that has not reported), its own family.
  func families(of face: DesktopPinFace, _ appId: String) -> [WidgetFamily] {
    guard let id = face.widgetId else { return DesktopPinFace.tileFamilies }
    guard
      let declared = declarations(appId)?.widgets.first(where: { $0.id == id })?.families
    else { return [face.family] }
    return [WidgetFamily.systemSmall, .systemMedium, .systemLarge].filter { declared.contains($0) }
  }

  /// The families the record's pin can take, smallest first: the sizes its menu offers.
  func families(_ record: DesktopPinRecord) -> [WidgetFamily] {
    families(of: fallbackFace(record), record.appId)
  }

  /// The sizes `face` handles well on the app's pin, one range for each family it can take, in
  /// that order. A tile grows taller only when the app has a description to fill it with.
  func ranges(_ face: DesktopPinFace, _ appId: String) -> [DesktopPinGeometry.SizeRange] {
    let families = families(of: face, appId)
    guard face.widgetId == nil else { return families.map { WidgetCard.pinRange(of: $0) } }
    let described = launcherDescription(appId) != nil
    return families.map { WidgetCard.tileRange(of: $0, described: described) }
  }

  /// The family `face` shows in on the app's pin of `size`: of those it can take, the largest
  /// whose range holds the size, once kept to the ranges.
  func family(for size: WindowSize, _ face: DesktopPinFace, _ appId: String) -> WidgetFamily {
    let ranges = ranges(face, appId)
    let held = DesktopPinGeometry.clamp(size, to: ranges)
    let index = DesktopPinGeometry.layout(of: held, among: ranges)
    return index.map { families(of: face, appId)[$0] } ?? face.family
  }

  /// The record's size: its own, kept to the sizes its face handles well, else its family's.
  func pinSize(_ record: DesktopPinRecord) -> WindowSize {
    let face = fallbackFace(record)
    guard let size = record.size else { return Self.size(of: face.family) }
    return DesktopPinGeometry.clamp(size, to: ranges(face, record.appId))
  }

  /// Where the record's pin goes: its size at its offset, inside its display's work area.
  func frame(for record: DesktopPinRecord) -> ScreenRect {
    let placement = DesktopPinScreens.placement(display: record.display)
    return DesktopPinGeometry.frame(
      offset: record.offset, size: pinSize(record), in: placement.workArea)
  }

  /// The ways the resize corners' cursors point for the record's pin as drawn: out at its
  /// smallest size, in at its largest, both ways between.
  func resizeDirections(_ record: DesktopPinRecord) -> NSCursor.FrameResizeDirection.Set? {
    let ranges = ranges(fallbackFace(record), record.appId)
    guard let first = ranges.first else { return nil }
    let size = drawnFrame(record).size
    let low = ranges.reduce(first.min) { lowest, range in
      WindowSize(
        width: min(lowest.width, range.min.width), height: min(lowest.height, range.min.height))
    }
    let high = ranges.reduce(first.max) { highest, range in
      WindowSize(
        width: max(highest.width, range.max.width), height: max(highest.height, range.max.height))
    }
    if size.width <= low.width, size.height <= low.height { return .outward }
    return size.width >= high.width && size.height >= high.height ? .inward : .all
  }
}
