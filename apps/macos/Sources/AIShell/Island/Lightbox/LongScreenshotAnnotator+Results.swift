import AICore
import AppKit

/// Text command results on the long screenshot (contract C3.1 §3): they land in the annotator's
/// store in any mode, so the card keeps them with everything else on the image and annotate mode
/// edits them, and ⌥ held outside annotate mode peeks at the image without the replacements.
extension LongScreenshotAnnotator {
  /// Whether a result may land now: a commit ends any preview, so not while a gesture draws,
  /// moves or resizes, text is open, or ⌥ shows the original.
  var canLand: Bool {
    !interaction.isGesturing && !textEditor.isEditing && store.preview == nil
  }

  /// What results land with: the editor's remembered step and highlighter styles, the kept image
  /// as the bounds steps stay in, the colours under each paragraph sampled from the long image's
  /// own pixels, and the renderer's text measure.
  func landingContext() -> CaptureTextMarks.Context {
    let styles = AnnotationStyleMemory.load(from: defaults)
    let shot = card.source.shot
    let kept = card.state.kept
    let scale = shot.scale
    return CaptureTextMarks.Context(
      stepStyle: styles[AnnotationTool.step.styleSlot],
      highlightStyle: styles[AnnotationTool.highlighter.styleSlot],
      bounds: CGRect(x: 0, y: kept.top, width: shot.pointSize.width, height: kept.height),
      colors: { paragraph in
        let box = paragraph.box
        let region = CGRect(
          x: box.minX * scale, y: box.minY * scale, width: box.width * scale,
          height: box.height * scale)
        return CaptureTextColors.sample(shot.image, region: region) ?? .fallback
      },
      measure: { text, size, width in AnnotationRenderer.measure(text, fontSize: size, width: width)
      })
  }

  /// ⌥ went down (`on`) or up outside annotate mode: the canvas shows the image without the text
  /// commands' replacements (`replacements`, annotation ids, those a review previews included),
  /// or as it is again. Nothing is committed, so the card keeps what is on the image.
  func peek(_ on: Bool, without replacements: Set<UUID>) {
    guard !active else { return }
    // The preview is drawn apart from the document: the canvas leaves its replacements out.
    drawing.hiddenAnnotations = on ? replacements : []
    if on, !replacements.isEmpty {
      var original = store.document
      for id in replacements { original.remove(id) }
      store.preview = original
    } else if store.preview != nil {
      store.preview = nil
    }
  }

  /// ⌘Z and ⇧⌘Z outside annotate mode, where the canvas does not take them: the store's undo
  /// still steps through what landed and what was covered (decision D5). False when there was
  /// nothing to undo or redo.
  func undoKey(redo: Bool) -> Bool {
    if redo {
      guard store.undoManager.canRedo else { return false }
      store.redo()
    } else {
      guard store.undoManager.canUndo else { return false }
      store.undo()
    }
    return true
  }
}
