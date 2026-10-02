import Foundation
import Testing

@testable import AICore

@Suite("Annotation style memory")
struct AnnotationStyleMemoryTests {
  /// A throwaway defaults domain per test, removed afterwards.
  func withDefaults(_ body: (UserDefaults) -> Void) {
    let suite = "AnnotationStyleMemoryTests.\(UUID().uuidString)"
    guard let defaults = UserDefaults(suiteName: suite) else {
      Issue.record("no defaults suite")
      return
    }
    body(defaults)
    defaults.removePersistentDomain(forName: suite)
  }

  @Test("Nothing stored: red at medium, the highlighter yellow at medium, no background")
  func fallbacks() {
    withDefaults { defaults in
      let styles = AnnotationStyleMemory.load(from: defaults)
      #expect(styles.shared == AnnotationStyle(color: .red, stroke: .medium))
      #expect(styles.highlighter == AnnotationStyle(color: .yellow, stroke: .medium))
    }
  }

  @Test("Saved styles come back in a later session, under the capture.annotation. keys")
  func roundTrip() {
    withDefaults { defaults in
      let styles = AnnotationStyles(
        shared: AnnotationStyle(color: .blue, stroke: .thick, textBackground: true),
        highlighter: AnnotationStyle(color: .green, stroke: .thin))
      AnnotationStyleMemory.save(styles, to: defaults)
      #expect(AnnotationStyleMemory.load(from: defaults) == styles)
      let keys = defaults.dictionaryRepresentation().keys.filter {
        $0.hasPrefix(AnnotationStyleMemory.prefix)
      }
      #expect(keys.count == 5)
      #expect(defaults.string(forKey: "capture.annotation.highlighter.color") == "green")
    }
  }

  @Test("An unknown stored value costs only that part of the style")
  func unknownValues() {
    withDefaults { defaults in
      defaults.set("purple", forKey: "capture.annotation.style.color")
      defaults.set("thick", forKey: "capture.annotation.style.stroke")
      let styles = AnnotationStyleMemory.load(from: defaults)
      #expect(styles.shared == AnnotationStyle(color: .red, stroke: .thick))
    }
  }

  @Test("The highlighter has its own slot; spotlights and the select tool have no style")
  func slotsAndControls() {
    #expect(AnnotationTool.highlighter.styleSlot == .highlighter)
    #expect(AnnotationTool.pen.styleSlot == .shared)
    #expect(AnnotationShape.highlighter([]).styleSlot == .highlighter)
    #expect(AnnotationShape.text("", frame: .zero).styleSlot == .shared)
    var styles = AnnotationStyles.defaults
    styles[.highlighter] = AnnotationStyle(color: .blue)
    #expect(styles.highlighter.color == .blue)
    #expect(styles.shared.color == .red)
    #expect(AnnotationTool.spotlight.styleControls.isEmpty)
    #expect(AnnotationTool.select.styleControls.isEmpty)
    #expect(AnnotationShape.spotlight(.zero).styleControls.isEmpty)
    #expect(AnnotationShape.mosaic(.zero).styleControls == .strokes)
    #expect(AnnotationTool.text.styleControls.contains(.textBackground))
    #expect(!AnnotationTool.rectangle.styleControls.contains(.textBackground))
    #expect(AnnotationShape.step(center: .zero).styleControls == [.colors, .strokes])
  }
}
