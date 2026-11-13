import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Capture visual marks, hybrid card, and output choices")
struct CaptureVisualMarksTests {
  private static func makeContext(
    bounds: CGRect = CGRect(x: 0, y: 0, width: 1_000, height: 500),
    style: AnnotationStyle = AnnotationStyle(color: .blue, redaction: .blur)
  ) -> CaptureTextMarks.Context {
    CaptureTextMarks.Context(
      stepStyle: style, highlightStyle: AnnotationStyle(color: .yellow), bounds: bounds,
      colors: { _ in .fallback },
      measure: { text, size, _ in CGSize(width: CGFloat(text.count) * size * 0.5, height: size) })
  }

  @Test("canAnnotate offers Annotate without selection-editing outputs outside text mode")
  func outputChoiceCanAnnotate() throws {
    let names = CommandOutputChoice.Names(
      label: "When done",
      actions: [
        .panel: "Panel", .card: "Card", .replaceSelection: "Replace",
        .insertAfterSelection: "After", .annotate: "Annotate", .insertAtCursor: "Cursor",
        .copy: "Copy",
      ],
      saved: "%@ (default)")
    let screenshotOptions = CommandOutputChoice.appending(
      CommandOutputOption(value: .card, saved: .annotate, selection: false), to: [], names: names,
      cursor: false, screenshotText: false, canAnnotate: true)
    guard case .choice(let screenshotChoice) = try #require(screenshotOptions.first) else {
      Issue.record("Expected output choice")
      return
    }
    #expect(
      screenshotChoice.options.map(\.value) == ["panel", "card", "annotate", "copy"])
    #expect(
      screenshotChoice.options.first(where: { $0.value == "annotate" })?.label
        == "Annotate (default)")

    // Default callers without `canAnnotate` keep omitting Annotate when `selection` is false.
    let legacyOptions = CommandOutputChoice.appending(
      CommandOutputOption(value: .card, saved: .panel, selection: false), to: [], names: names,
      cursor: false, screenshotText: true)
    guard case .choice(let legacyChoice) = try #require(legacyOptions.first) else {
      Issue.record("Expected output choice")
      return
    }
    #expect(legacyChoice.options.map(\.value) == ["panel", "card", "copy"])
  }

  @Test("Zero-paragraph Ask runs encode empty paragraphs and rescope on crop changes")
  func zeroParagraphRunAndRescope() {
    let cropA = CGRect(x: 20, y: 30, width: 200, height: 150)
    let cropB = CGRect(x: 20, y: 30, width: 320, height: 220)
    var run = CaptureTextRun(
      id: "ct-visual-1", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .screenshot, count: 0), paragraphs: [], output: .annotate,
      bounds: cropA)
    let startEvent = run.event(
      surface: .capture, question: "Circle the icon", arguments: nil, files: [])
    #expect(startEvent.scope == .all)
    #expect(startEvent.paragraphs.isEmpty)

    // Unchanged zero-paragraph crop skips rescope; resized crop rescopes even with zero text.
    #expect(
      run.rescope([], scope: CaptureTextScope(kind: .screenshot, count: 0), bounds: cropA) == nil)
    let rescoped = run.rescope(
      [], scope: CaptureTextScope(kind: .screenshot, count: 0), bounds: cropB)
    #expect(rescoped?.isEmpty == true)
    #expect(run.selectionBounds == cropB)

    // Saved replaceSelection command refuses rescoping onto zero paragraphs.
    let paragraph = CaptureTextParagraph(lines: [
      (text: "Hello", box: CGRect(x: 0, y: 0, width: 80, height: 18))
    ])
    var translateRun = CaptureTextRun(
      id: "ct-tr-1", commandId: "translate", command: "Translate",
      scope: CaptureTextScope(kind: .all, count: 1), paragraphs: [paragraph],
      output: .replaceSelection, bounds: cropA)
    #expect(
      translateRun.rescope([], scope: CaptureTextScope(kind: .all, count: 0), bounds: cropB) == nil)
  }

  @Test("Normalized 0..1000 visual coordinates map to native AnnotationShape geometry")
  func visualCoordinateShapes() throws {
    let bounds = CGRect(x: -400, y: 100, width: 1_000, height: 500)
    let sharedStyle = AnnotationStyle(color: .green, redaction: .solid)
    let context = Self.makeContext(bounds: bounds, style: sharedStyle)

    var run = CaptureTextRun(
      id: "ct-shapes", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .screenshot, count: 0), paragraphs: [], output: .annotate,
      bounds: bounds)
    let items: [CaptureTextResult.Item] = [
      .init(
        tool: .box, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 100, y1: 200, x2: 300, y2: 400), text: "Submit button"),
      .init(
        tool: .ellipse, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 500, y1: 100, x2: 700, y2: 300), text: ""),
      .init(
        tool: .arrow, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 800, y1: 100, x2: 600, y2: 500), text: "Target avatar"),
      .init(
        tool: .spotlight, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 0, y1: 0, x2: 500, y2: 500), text: ""),
      .init(
        tool: .mosaic, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 250, y1: 600, x2: 450, y2: 700), text: "QR code"),
      .init(
        tool: .step, paragraph: nil, phrase: nil, point: .init(x: 0, y: 0), coords: nil,
        text: "First click here"),
      .init(
        tool: .step, paragraph: nil, phrase: nil, point: nil,
        coords: .init(x1: 900, y1: 800, x2: 750, y2: 650), text: "Then inspect here"),
    ]
    _ = run.apply(
      CaptureTextProgressParams(
        runId: run.id, state: .done, output: .annotate, text: "",
        result: .init(lead: "Overview", items: items), awaitsApply: false, review: nil, draft: nil),
      in: AnnotationDocument())
    #expect(run.items.count == 7)

    let (document, produced) = CaptureTextMarks.applying(
      run, to: AnnotationDocument(), context: context)
    run.landed(produced)
    #expect(document.annotations.count == 7)
    for annotation in document.annotations {
      #expect(AnnotationPath.isSubstantial(annotation.shape))
      #expect(annotation.style == sharedStyle)
    }

    #expect(
      document.annotations[0].shape
        == .rectangle(CGRect(x: -300, y: 200, width: 200, height: 100)))
    #expect(
      document.annotations[1].shape == .ellipse(CGRect(x: 100, y: 150, width: 200, height: 100)))
    // Arrow preserves shaft tail (x1,y1) -> arrowhead tip (x2,y2) pointing at target.
    #expect(
      document.annotations[2].shape
        == .arrow(from: CGPoint(x: 400, y: 150), to: CGPoint(x: 200, y: 350)))
    #expect(
      document.annotations[3].shape
        == .spotlight(CGRect(x: -400, y: 100, width: 500, height: 250)))
    #expect(
      document.annotations[4].shape
        == .mosaic(CGRect(x: -150, y: 400, width: 200, height: 50)))

    let radius = sharedStyle.stroke.stepDiameter / 2
    guard case .step(let firstCenter, let firstTip) = document.annotations[5].shape else {
      Issue.record("Expected point step")
      return
    }
    #expect(firstCenter == CGPoint(x: -400 + radius, y: 100 + radius))
    #expect(firstTip == nil)

    guard case .step(let secondCenter, let secondTip) = document.annotations[6].shape else {
      Issue.record("Expected tailed step")
      return
    }
    #expect(secondCenter == CGPoint(x: 500, y: 500))
    #expect(secondTip == CGPoint(x: 350, y: 425))
    #expect(run.stepNumbers(in: document) == [5: 1, 6: 2])

    let card = CaptureResultCard(run: run, document: document)
    #expect(
      card.notes == [.steps(first: 1, last: 2), .marked(4), .redacted(1)])
    guard case .items(let lead, let entries) = card.body else {
      Issue.record("Expected items body")
      return
    }
    #expect(lead == "Overview")
    #expect(entries.map(\.marker) == [.box, .arrow, .mosaic, .number(1), .number(2)])

    var runs = CaptureTextRuns()
    runs.start(run)
    let summary = runs.summary(in: document)
    #expect(summary.steps == 2)
    #expect(summary.marks == 4)
    #expect(summary.redactions == 1)
  }

  @Test("OCR paragraph mosaic redacts matching phrase or whole paragraph with redaction margin")
  func ocrParagraphMosaic() throws {
    let paragraph = CaptureTextParagraph(lines: [
      (text: "Token sk-secret-123456 here", box: CGRect(x: 40, y: 50, width: 270, height: 20))
    ])
    var run = CaptureTextRun(
      id: "ct-redact", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .all, count: 1), paragraphs: [paragraph], output: .annotate)
    let id = run.paragraphs[0].id
    _ = run.apply(
      CaptureTextProgressParams(
        runId: run.id, state: .done, output: .annotate, text: "",
        result: .init(
          lead: "",
          items: [
            .init(
              tool: .mosaic, paragraph: id, phrase: "sk-secret-123456", point: nil, coords: nil,
              text: ""),
            .init(tool: .mosaic, paragraph: id, phrase: nil, point: nil, coords: nil, text: ""),
          ]),
        awaitsApply: false, review: nil, draft: nil),
      in: AnnotationDocument())
    let (document, produced) = CaptureTextMarks.applying(
      run, to: AnnotationDocument(), context: Self.makeContext())
    run.landed(produced)
    #expect(document.annotations.count == 2)
    guard case .mosaic(let phraseRect) = document.annotations[0].shape,
      case .mosaic(let fullRect) = document.annotations[1].shape
    else {
      Issue.record("Expected mosaic annotations")
      return
    }
    #expect(phraseRect.minX > fullRect.minX && phraseRect.maxX < fullRect.maxX)
    #expect(fullRect == CGRect(x: 37, y: 47, width: 276, height: 26))
  }

  @Test("Zero-mark annotate answer renders as plain-text card without dead Restore")
  func hybridPlainTextAnnotateCard() {
    var run = CaptureTextRun(
      id: "ct-qa", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .screenshot, count: 0), paragraphs: [], output: .annotate)
    _ = run.apply(
      CaptureTextProgressParams(
        runId: run.id, state: .done, output: .annotate, text: "",
        result: .init(lead: "This dialog asks to confirm deletion.", items: []),
        awaitsApply: false, review: nil, draft: nil),
      in: AnnotationDocument())
    let card = CaptureResultCard(run: run, document: AnnotationDocument(), canInsert: true)
    #expect(card.body == .answer("This dialog asks to confirm deletion."))
    #expect(card.notes == [.unchanged])
    #expect(card.actions == [.open, .copy])
    #expect(card.primary == .copy)
    #expect(card.copyText == "This dialog asks to confirm deletion.")
    #expect(!card.actions.contains(.revert))
  }

  @Test("Visual annotations clamp stroke at default while keeping user color and redaction")
  func visualAnnotationStrokeClamp() {
    let thickContext = Self.makeContext(
      style: AnnotationStyle(color: .yellow, stroke: AnnotationStroke(1.0), redaction: .blur))
    let boxItem = CaptureTextResult.Item(
      tool: .box, paragraph: nil, phrase: nil, point: nil,
      coords: .init(x1: 100, y1: 100, x2: 300, y2: 300), text: "")
    let stepItem = CaptureTextResult.Item(
      tool: .step, paragraph: nil, phrase: nil, point: .init(x: 500, y: 250), coords: nil,
      text: "Check here")
    let clampedBox = CaptureTextMarks.visualAnnotations(for: boxItem, context: thickContext)
    let clampedStep = CaptureTextMarks.visualAnnotations(for: stepItem, context: thickContext)
    let expectedClamped = AnnotationStyle(
      color: .yellow, stroke: .default, redaction: .blur)
    #expect(clampedBox.first?.style == expectedClamped)
    #expect(clampedStep.first?.style == expectedClamped)

    let thinStyle = AnnotationStyle(
      color: .yellow, stroke: AnnotationStroke(0.1), redaction: .blur)
    let thinContext = Self.makeContext(style: thinStyle)
    #expect(
      CaptureTextMarks.visualAnnotations(for: boxItem, context: thinContext).first?.style
        == thinStyle)
  }

  @Test("Run start and retry reading encode normalized 0..1000 paragraph bounds when bounded")
  func runParagraphNormalizedBounds() {
    let first = CaptureTextParagraph(lines: [
      (text: "First", box: CGRect(x: 100, y: 150, width: 200, height: 100))
    ])
    let outside = CaptureTextParagraph(lines: [
      (text: "Clipped", box: CGRect(x: -50, y: 400, width: 250, height: 200))
    ])
    let selection = CGRect(x: 50, y: 100, width: 1_000, height: 500)

    let unboundedRun = CaptureTextRun(
      id: "ct-unbounded", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .all, count: 1), paragraphs: [first], output: .annotate)
    let unboundedEvent = unboundedRun.event(surface: .capture, arguments: nil, files: [])
    #expect(unboundedEvent.paragraphs.map(\.bounds) == [nil])
    #expect(unboundedRun.reading(files: []).paragraphs.map(\.bounds) == [nil])

    var boundedRun = CaptureTextRun(
      id: "ct-bounded", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .all, count: 2), paragraphs: [first, outside],
      output: .annotate, bounds: selection)
    let startEvent = boundedRun.event(surface: .capture, arguments: nil, files: [])
    #expect(
      startEvent.paragraphs.map(\.bounds) == [
        .init(x1: 50, y1: 100, x2: 250, y2: 300),
        .init(x1: 0, y1: 600, x2: 150, y2: 1_000),
      ])

    let nextSelection = CGRect(x: 100, y: 150, width: 400, height: 200)
    _ = boundedRun.rescope(
      [first], scope: CaptureTextScope(kind: .all, count: 1), bounds: nextSelection)
    #expect(
      boundedRun.reading(files: []).paragraphs.map(\.bounds) == [
        .init(x1: 0, y1: 0, x2: 500, y2: 500)
      ])
    #expect(CaptureTextRun.normalizedBounds(of: first.box, in: .zero) == nil)
  }
}
