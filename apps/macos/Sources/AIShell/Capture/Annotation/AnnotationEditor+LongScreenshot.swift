import AICore
import AppKit

/// The toolbar's long screenshot button, which the session drives
/// (``AnnotationEditing/longScreenshot``): the editor only passes its state and clicks through.
extension AnnotationEditor {
  var longScreenshot: LongScreenshotAvailability? {
    get { toolbar.longScreenshot }
    set {
      let resizes = (toolbar.longScreenshot == nil) != (newValue == nil)
      toolbar.longScreenshot = newValue
      // Showing or hiding the button changes the toolbar's width, so the bars are placed again.
      if resizes, toolbar.superview != nil { refresh() }
    }
  }

  var onLongScreenshot: (() -> Void)? {
    get { toolbar.onLongScreenshot }
    set { toolbar.onLongScreenshot = newValue }
  }
}
