import AICore
import AppKit

/// A confirmed capture: what is imported, and what reopening it later needs (decision F2).
struct CaptureConfirmation {
  /// The selection's pixels with the annotations drawn in.
  let image: CGImage
  /// The same pixels without annotations.
  let raw: CGImage
  /// Pixels per point of the image: the display's, or the finest of those a selection spans.
  let pixelScale: CGFloat
  /// The annotations, selection-local.
  let document: AnnotationDocument
  /// The display holding most of the selection.
  let displayID: CGDirectDisplayID
  /// That display's Quartz frame.
  let displayFrame: CGRect
  /// The selection in that display's view points; it reaches past the display when it spans
  /// several.
  let selection: CGRect
  /// The selection in the session's desktop points.
  let desktopSelection: CGRect
  /// The element the selection was picked from, described; set by ``CaptureSession/run()``.
  var element: ElementDescription?
  /// The text text mode offered as the capture ended (``AnnotationEditing/pickedText``), which a
  /// launched command or question also reads; nil when text mode was off or had no text.
  var pickedText: String?
}
