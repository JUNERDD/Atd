import AICore
import Foundation

/// The answer under review as a surface draws it over its image (decision D12, the plan's
/// 「截图上先显示虚线预览」): what the run under review (``CaptureTextRuns/reviewing``) would put
/// on the image now (``CaptureTextMarks/preview(_:over:context:)``), worked out again only when
/// the run, the image's annotations or the styles marks start from changed. Between those the
/// preview keeps its annotations, so a surface refreshing for anything else redraws nothing and
/// the ids ⌥ hides stay the ones drawn. The capture editor and the long screenshot's full-screen
/// preview each keep one, and hand ``preview`` to their canvas.
final class CaptureTextReviewPreview {
  private struct Source: Equatable {
    let run: CaptureTextRun
    let document: AnnotationDocument
    let stepStyle: AnnotationStyle
    let highlightStyle: AnnotationStyle
    let bounds: CGRect
  }

  private var source: Source?
  /// The preview as last worked out; nil while nothing waits for review.
  private(set) var preview: CaptureTextPreview?

  /// The preview of what `runs` has under review over `document`, with what `context` says marks
  /// need.
  @discardableResult
  func update(
    _ runs: CaptureTextRuns, over document: AnnotationDocument,
    context: CaptureTextMarks.Context
  ) -> CaptureTextPreview? {
    guard let run = runs.reviewing else {
      source = nil
      preview = nil
      return nil
    }
    let next = Source(
      run: run, document: document, stepStyle: context.stepStyle,
      highlightStyle: context.highlightStyle, bounds: context.bounds)
    guard next != source else { return preview }
    source = next
    preview = CaptureTextMarks.preview(run, over: document, context: context)
    return preview
  }
}
