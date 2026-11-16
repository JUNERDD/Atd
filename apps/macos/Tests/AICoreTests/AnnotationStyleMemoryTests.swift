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

  @Test("Nothing stored: red at the default size, the highlighter yellow, no background")
  func fallbacks() {
    withDefaults { defaults in
      let styles = AnnotationStyleMemory.load(from: defaults)
      #expect(styles.shared == AnnotationStyle(color: .red))
      #expect(styles.highlighter == AnnotationStyle(color: .yellow))
    }
  }

  @Test("Saved styles come back in a later session, under the capture.annotation. keys")
  func roundTrip() {
    withDefaults { defaults in
      let sharedCustom = AnnotationRGBA(red: 0.25, green: 0.5, blue: 0.75, alpha: 0.6)
      let hiCustom = AnnotationRGBA(red: 0.9, green: 0.8, blue: 0.1, alpha: 0.4)
      let styles = AnnotationStyles(
        shared: AnnotationStyle(
          color: .blue, stroke: AnnotationStroke(0.75), textBackground: true, redaction: .blur,
          customColor: sharedCustom, fillMode: .soft, cornerStyle: .rounded,
          arrowStyle: .doubleHeaded, isDashed: true, textPlate: .frosted, mosaicMode: .brush,
          spotlightShape: .ellipse, fontFamily: "Inter"),
        highlighter: AnnotationStyle(
          color: .green, stroke: AnnotationStroke(0.1), customColor: hiCustom))
      AnnotationStyleMemory.save(styles, to: defaults)
      #expect(AnnotationStyleMemory.load(from: defaults) == styles)
      #expect(defaults.string(forKey: "capture.annotation.highlighter.color") == "green")
      #expect(defaults.string(forKey: "capture.annotation.style.fontFamily") == "Inter")

      let cleared = AnnotationStyles.defaults
      AnnotationStyleMemory.save(cleared, to: defaults)
      #expect(AnnotationStyleMemory.load(from: defaults) == cleared)
      #expect(defaults.object(forKey: "capture.annotation.style.fontFamily") == nil)
      #expect(defaults.object(forKey: "capture.annotation.style.customR") == nil)
      #expect(defaults.object(forKey: "capture.annotation.highlighter.customR") == nil)
    }
  }

  @Test("Legacy textBackground bool upgrades to solid textPlate when textPlate key is absent")
  func legacyTextBackgroundFallback() {
    withDefaults { defaults in
      defaults.set(true, forKey: "capture.annotation.style.textBackground")
      let loaded = AnnotationStyleMemory.load(from: defaults)
      #expect(loaded.shared.textBackground)
      #expect(loaded.shared.textPlate == .solid)
    }
  }

  @Test("Recent colors and fonts deduplicate, move to front, and cap at eight")
  func recentColorsAndFonts() {
    withDefaults { defaults in
      for i in 0..<10 {
        AnnotationStyleMemory.recordRecentColor(
          AnnotationRGBA(red: Double(i) / 10.0, green: 0.2, blue: 0.3, alpha: 1), to: defaults)
        AnnotationStyleMemory.recordRecentFont("Font\(i)", to: defaults)
      }
      let colors = AnnotationStyleMemory.loadRecentColors(from: defaults)
      #expect(colors.count == 8)
      #expect(abs(colors[0].red - 0.9) < 0.001)
      // Re-recording the oldest retained item with tiny sub-8-bit noise promotes and deduplicates.
      AnnotationStyleMemory.recordRecentColor(
        AnnotationRGBA(red: 0.2 + 0.0001, green: 0.2, blue: 0.3, alpha: 1), to: defaults)
      let promotedColors = AnnotationStyleMemory.loadRecentColors(from: defaults)
      #expect(promotedColors.count == 8)
      #expect(abs(promotedColors[0].red - 0.2) < 0.001)

      AnnotationStyleMemory.recordRecentFont("  ", to: defaults)
      AnnotationStyleMemory.recordRecentFont("font2", to: defaults)
      let fonts = AnnotationStyleMemory.loadRecentFonts(from: defaults)
      #expect(fonts.count == 8)
      #expect(fonts[0] == "font2")
      #expect(fonts.filter { $0.caseInsensitiveCompare("Font2") == .orderedSame }.count == 1)
    }
  }

  @Test("An unknown stored value costs only that part of the style")
  func unknownValues() {
    withDefaults { defaults in
      defaults.set("purple", forKey: "capture.annotation.style.color")
      defaults.set(0.8, forKey: "capture.annotation.style.stroke")
      #expect(
        AnnotationStyleMemory.load(from: defaults).shared
          == AnnotationStyle(color: .red, stroke: AnnotationStroke(0.8)))
      // A size the former three widths stored by name falls back to the default.
      defaults.set("thick", forKey: "capture.annotation.style.stroke")
      #expect(AnnotationStyleMemory.load(from: defaults).shared.stroke == .default)
    }
  }

  @Test("The highlighter has its own slot; tools and shapes expose their upgraded controls")
  func slotsAndControls() {
    #expect(AnnotationTool.highlighter.styleSlot == .highlighter)
    #expect(AnnotationTool.pen.styleSlot == .shared)
    #expect(AnnotationShape.highlighter([]).styleSlot == .highlighter)
    #expect(AnnotationShape.text("", frame: .zero).styleSlot == .shared)
    var styles = AnnotationStyles.defaults
    styles[.highlighter] = AnnotationStyle(color: .blue)
    #expect(styles.highlighter.color == .blue)
    #expect(styles.shared.color == .red)
    #expect(AnnotationTool.select.styleControls.isEmpty)
    #expect(
      AnnotationTool.spotlight.styleControls == [.spotlightShape, .spotlightDim, .cornerStyle])
    #expect(
      AnnotationShape.spotlight(.zero).styleControls
        == [.spotlightShape, .spotlightDim, .cornerStyle])
    #expect(AnnotationShape.mosaic(.zero).styleControls == [.mosaicMode, .redaction, .strokes])
    #expect(AnnotationShape.mosaicBrush([]).styleControls == [.mosaicMode, .redaction, .strokes])
    #expect(
      AnnotationShape.mosaic(.zero).styleControls.shown(for: AnnotationStyle(redaction: .solid))
        == [.mosaicMode, .redaction])
    #expect(
      AnnotationShape.mosaicBrush([]).styleControls.shown(
        for: AnnotationStyle(redaction: .solid, mosaicMode: .brush))
        == [.mosaicMode, .redaction, .strokes])
    #expect(
      AnnotationTool.text.styleControls == [.colors, .strokes, .textBackground, .fontFamily])
    #expect(
      AnnotationTool.rectangle.styleControls
        == [.colors, .strokes, .fillMode, .cornerStyle, .dashed])
    #expect(AnnotationShape.step(center: .zero).styleControls == [.colors, .strokes, .stepConfig])
  }
}
