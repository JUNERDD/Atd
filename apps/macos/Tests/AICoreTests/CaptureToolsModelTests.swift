import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Capture tools upgraded models, Codable compatibility, and selection layout")
struct CaptureToolsModelTests {
  @Test("AnnotationRGBA formats hex/rgb, computes lightness, and parses hex inputs")
  func rgbaUtilities() {
    let custom = AnnotationRGBA(red: 1, green: 0.5, blue: 0, alpha: 0.75)
    #expect(custom.hexString == "#FF8000")
    #expect(custom.rgbString == "rgb(255, 128, 0)")
    #expect(AnnotationRGBA.white.isLight)
    #expect(!AnnotationRGBA.black.isLight)

    #expect(AnnotationRGBA.parseHex("#abc") == AnnotationRGBA.parseHex("AABBCC"))
    let alphaHex = AnnotationRGBA.parseHex("#33669980")
    #expect(alphaHex != nil)
    #expect(abs((alphaHex?.alpha ?? 0) - (128.0 / 255.0)) < 0.002)
    #expect(AnnotationRGBA.parseHex("invalid") == nil)
    #expect(AnnotationRGBA.parseHex("#12345") == nil)
  }

  @Test("AnnotationStyle effectiveRGBA, resolvedTextPlate, cornerRadius, and .with double-optional")
  func styleHelpersAndWith() {
    let custom = AnnotationRGBA(red: 0.1, green: 0.2, blue: 0.3, alpha: 0.5)
    let styled = AnnotationStyle(
      color: .blue, customColor: custom, cornerStyle: .rounded, fontFamily: "Menlo")
    #expect(styled.effectiveRGBA == custom)
    #expect(styled.cornerRadius(for: CGRect(x: 0, y: 0, width: 20, height: 100)) == 4.4)
    #expect(styled.cornerRadius(for: CGRect(x: 0, y: 0, width: 100, height: 100)) == 12)

    let cleared = styled.with(customColor: .some(nil), fontFamily: .some(nil))
    #expect(cleared.customColor == nil)
    #expect(cleared.effectiveRGBA == AnnotationColor.blue.rgba)
    #expect(cleared.fontFamily == nil)

    let sampled = AnnotationStyle(
      plate: AnnotationRGBA(red: 0.9, green: 0.9, blue: 0.9), textPlate: AnnotationTextPlate.none)
    #expect(sampled.resolvedTextPlate == .solid)

    let fontChange = AnnotationStyleChange(customColor: .some(nil), fontChoice: .family("Inter"))
    let afterChange = fontChange.applied(to: styled)
    #expect(afterChange.customColor == nil)
    #expect(afterChange.fontFamily == "Inter")
  }

  @Test("Step numbering formats 1·2·3 and A·B·C sequences with stepStartIndex")
  func stepFormats() {
    #expect(AnnotationStepFormat.numbers.format(index: 0) == "1")
    #expect(AnnotationStepFormat.letters.format(index: 1) == "A")
    #expect(AnnotationStepFormat.letters.format(index: 26) == "Z")
    #expect(AnnotationStepFormat.letters.format(index: 27) == "AA")

    let first = Annotation(shape: .step(center: .zero), style: AnnotationStyle())
    let second = Annotation(shape: .step(center: CGPoint(x: 40, y: 0)), style: AnnotationStyle())
    let doc = AnnotationDocument(
      [first, second], spotlightDim: 0.95, stepFormat: .letters, stepStartIndex: 3)
    #expect(doc.spotlightDim == 0.85)
    #expect(doc.stepNumber(of: first.id) == 3)
    #expect(doc.stepNumber(of: second.id) == 4)
    #expect(doc.stepLabel(of: first.id) == "C")
    #expect(doc.stepLabel(of: second.id) == "D")
  }

  @Test("Codable round-trips upgraded document, all shapes, and style changes")
  func codableRoundTrip() throws {
    let custom = AnnotationRGBA(red: 0.2, green: 0.4, blue: 0.8, alpha: 0.65)
    let richStyle = AnnotationStyle(
      color: .green, stroke: AnnotationStroke(0.6), textBackground: true, redaction: .blur,
      customColor: custom, fillMode: .soft, cornerStyle: .rounded, arrowStyle: .doubleHeaded,
      isDashed: true, textPlate: .outlined, mosaicMode: .brush, spotlightShape: .ellipse,
      fontFamily: "Roboto")
    let doc = AnnotationDocument(
      [
        Annotation(shape: .rectangle(CGRect(x: 1, y: 2, width: 30, height: 40)), style: richStyle),
        Annotation(
          shape: .arrow(from: .zero, to: CGPoint(x: 60, y: 20), bend: CGPoint(x: 30, y: -15)),
          style: richStyle),
        Annotation(
          shape: .line(from: CGPoint(x: 5, y: 5), to: CGPoint(x: 50, y: 50), bend: nil),
          style: richStyle),
        Annotation(
          shape: .mosaicBrush([CGPoint(x: 10, y: 10), CGPoint(x: 35, y: 25)]), style: richStyle),
        Annotation(
          shape: .spotlight(CGRect(x: 12, y: 14, width: 80, height: 80)), style: richStyle),
      ],
      spotlightDim: 0.65, stepFormat: .letters, stepStartIndex: 2)

    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let encodedDoc = try encoder.encode(doc)
    let decodedDoc = try decoder.decode(AnnotationDocument.self, from: encodedDoc)
    #expect(decodedDoc == doc)

    let clearCustomChange = AnnotationStyleChange(
      customColor: .some(nil), fillMode: .solid, fontChoice: .system)
    let decodedChange = try decoder.decode(
      AnnotationStyleChange.self, from: try encoder.encode(clearCustomChange))
    #expect(decodedChange == clearCustomChange)
  }

  @Test("Codable decoding of minimal legacy JSON fills safe defaults")
  func codableBackwardCompatibility() throws {
    let decoder = JSONDecoder()
    let legacyStyle = try decoder.decode(AnnotationStyle.self, from: Data("{}".utf8))
    #expect(legacyStyle == AnnotationStyle())

    let singleValueStroke = try decoder.decode(AnnotationStroke.self, from: Data("0.75".utf8))
    #expect(singleValueStroke == AnnotationStroke(0.75))

    let legacyArrowJSON = Data(
      #"{"kind":"arrow","from":[0,0],"to":[40,20]}"#.utf8)
    let arrow = try decoder.decode(AnnotationShape.self, from: legacyArrowJSON)
    #expect(arrow == .arrow(from: .zero, to: CGPoint(x: 40, y: 20), bend: nil))

    let legacyDocJSON = Data(#"{"annotations":[]}"#.utf8)
    let doc = try decoder.decode(AnnotationDocument.self, from: legacyDocJSON)
    #expect(doc == AnnotationDocument())
  }

  @Test("SelectionModel+Layout supports aspect ratios and centered drags")
  func selectionLayoutPresetsAndCenteredDrag() {
    let model = SelectionModel(size: CGSize(width: 800, height: 600), scale: 2)
    let origin = CGPoint(x: 400, y: 300)
    let centered = model.rect(
      for: .create(origin: origin),
      to: CGPoint(x: 480, y: 350),
      constrained: false,
      centered: true,
      aspect: SelectionAspectPreset.r16x9.ratio)
    #expect(abs(centered.midX - origin.x) <= 1)
    #expect(abs(centered.midY - origin.y) <= 1)
    #expect(abs((centered.width / centered.height) - (16.0 / 9.0)) < 0.05)

    let fitted = model.applyingAspectPreset(
      .r1x1, to: CGRect(x: 200, y: 150, width: 200, height: 100))
    #expect(abs(fitted.width - fitted.height) <= 1)
    #expect(model.bounds.contains(fitted))
  }
}
