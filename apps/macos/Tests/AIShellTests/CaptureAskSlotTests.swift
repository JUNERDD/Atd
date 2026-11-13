import AICore
import AppKit
import CoreGraphics
import Testing

@testable import AIShell

@Suite("Capture Ask slot stickiness, screenshot row, and mosaic masking")
@MainActor
struct CaptureAskSlotTests {
  private static func makeSetup() -> CaptureCommandRowSetup {
    CaptureCommandRowSetup(
      commands: [], catalog: CommandOptionsCatalog(), onPick: { _, _ in },
      copyText: { _ in true }, openSettings: {}, cursor: true, cursorApp: "Notes")
  }

  @Test("askOutput stays sticky across openAsk within a session and resets on prepare")
  func askOutputStickinessAndClamping() {
    _ = NSApplication.shared
    let slot = AnnotationCommandSlot()
    var textMode = false
    var canModify = false
    slot.isTextMode = { textMode }
    slot.canModifySelection = { canModify }
    slot.prepare(Self.makeSetup(), maxWidth: 520)

    #expect(slot.askOutput == .annotate)
    #expect(slot.effectiveAskOutput == .annotate)

    // User switches output to `.card`, closes Ask, and reopens Ask: `.card` stays sticky.
    slot.askOutput = .card
    slot.openAsk()
    #expect(slot.askOutput == .card)
    #expect(slot.effectiveAskOutput == .card)
    #expect(slot.dismiss())
    slot.openAsk()
    #expect(slot.askOutput == .card)
    _ = slot.dismiss()

    // Selection-editing output picked in text mode falls back to `.annotate` outside text mode,
    // while returning to `.replaceSelection` when text mode with paragraphs reopens.
    textMode = true
    canModify = true
    slot.askOutput = .replaceSelection
    #expect(slot.effectiveAskOutput == .replaceSelection)
    textMode = false
    canModify = false
    #expect(slot.effectiveAskOutput == .annotate)
    textMode = true
    canModify = true
    #expect(slot.effectiveAskOutput == .replaceSelection)

    // Starting a new capture session resets `askOutput` back to `.annotate`.
    slot.prepare(Self.makeSetup(), maxWidth: 520)
    #expect(slot.askOutput == .annotate)
  }

  @Test("Screenshot row offers Ask split button, runs in place except Panel, and lights run bar")
  func screenshotRowAskRouting() throws {
    _ = NSApplication.shared
    let slot = AnnotationCommandSlot()
    var launched: [CaptureLaunch] = []
    var inPlace: [(String, CommandOutputAction)] = []
    slot.isTextMode = { false }
    slot.canModifySelection = { false }
    slot.onLaunch = { launched.append($0) }
    slot.onTextAsk = { inPlace.append(($0, $1)) }
    slot.prepare(Self.makeSetup(), maxWidth: 520)

    let screenshotRow = try #require(slot.row)
    #expect(screenshotRow.buttons[CaptureTextRun.askID] != nil)

    slot.openAsk()
    let askBar = try #require(slot.ask)
    #expect(!askBar.outputControl.isHidden)
    askBar.onSubmit?("Circle the warning")
    #expect(inPlace.count == 1)
    #expect(inPlace.first?.0 == "Circle the warning")
    #expect(inPlace.first?.1 == .annotate)
    #expect(launched.isEmpty)

    // On the screenshot row (`!textMode`), `.panel` still launches via `CaptureLaunch.ask`.
    slot.askOutput = .panel
    askBar.onSubmit?("Discuss in panel")
    #expect(launched == [.ask("Discuss in panel")])

    // Running bar on screenshot row tracks `@ask` only, never lighting `more` for saved text IDs.
    slot.setRunning(CaptureTextRun.askID)
    #expect(screenshotRow.running === screenshotRow.buttons[CaptureTextRun.askID])
    slot.setRunning("translate")
    #expect(screenshotRow.running == nil)
  }

  @Test("Landing, restoring, and undoing AI mosaic marks syncs text mode masking")
  func mosaicLandingAndRestoreMasking() {
    _ = NSApplication.shared
    let editor = AnnotationEditor()
    let box = ScreenContext.TextBox(
      text: "Secret 1234", box: CGRect(x: 40, y: 40, width: 120, height: 20))
    editor.recognizedText = CaptureText(boxes: [box], sensitive: [], glyphs: .empty)
    #expect(editor.text.mode.available == [0])

    let paragraph = editor.text.mode.layout[0]
    var run = CaptureTextRun(
      id: "ct-mask", commandId: CaptureTextRun.askID, command: "Ask Atd",
      scope: CaptureTextScope(kind: .screenshot, count: 1), paragraphs: [paragraph],
      output: .annotate)
    _ = run.apply(
      CaptureTextProgressParams(
        runId: run.id, state: .done, output: .annotate, text: "",
        result: .init(
          lead: "",
          items: [
            .init(
              tool: .mosaic, paragraph: run.paragraphs[0].id, phrase: nil, point: nil, coords: nil,
              text: "")
          ]),
        awaitsApply: false, review: nil, draft: nil),
      in: editor.store.document)
    editor.text.runs.start(run)
    editor.land(run.id)
    #expect(editor.text.mode.available.isEmpty)

    // Restore (`takeOff`) removes the AI mosaic and immediately unmasks the paragraph.
    let ids = editor.text.runs[run.id]?.annotationIDs ?? []
    #expect(editor.store.takeOff(ids))
    #expect(editor.text.mode.available == [0])

    // Undo brings back the Restore'd mosaic (masks again); second undo removes the landing.
    editor.store.undo()
    #expect(editor.text.mode.available.isEmpty)
    editor.store.undo()
    #expect(editor.text.mode.available == [0])
  }
}
