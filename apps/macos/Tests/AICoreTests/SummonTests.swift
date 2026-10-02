import Foundation
import Testing

@testable import AICore

@Suite("Summon flow and text capture")
struct SummonTests {
  static func context(key: Bool = false, filePanel: Bool = false, wanted: Bool = false)
    -> SummonContext
  {
    SummonContext(panelIsKey: key, filePanelOpen: filePanel, selectionWanted: wanted)
  }

  @Test("The contract's reserved ids toggle the panel and screenshot; any other id is a command")
  func triggerFromID() {
    #expect(SummonTrigger(hotKeyID: "togglePanel") == .toggle)
    #expect(SummonTrigger(hotKeyID: "captureScreenshot") == .screenshot)
    #expect(SummonTrigger(hotKeyID: "panel") == .command(id: "panel"))
  }

  @Test("A key panel hides without capturing")
  func keyPanelHides() {
    #expect(
      SummonPolicy.steps(for: .toggle, in: Self.context(key: true, wanted: true)) == [
        .hidePanel
      ])
  }

  @Test("Summons wait while a file panel is open")
  func filePanelIgnores() {
    #expect(SummonPolicy.steps(for: .toggle, in: Self.context(filePanel: true)).isEmpty)
    #expect(
      SummonPolicy.steps(for: .command(id: "c1"), in: Self.context(filePanel: true)).isEmpty)
  }

  @Test("Showing captures when a command wants the selection, and clears otherwise")
  func captureBeforeShow() {
    #expect(
      SummonPolicy.steps(for: .toggle, in: Self.context(wanted: true)) == [
        .captureSelection, .showPanel,
      ])
    #expect(
      SummonPolicy.steps(for: .toggle, in: Self.context()) == [
        .clearSelection, .showPanel,
      ])
  }

  @Test("A command shortcut captures, then hands only its id to the page")
  func commandDelivers() {
    #expect(
      SummonPolicy.steps(for: .command(id: "c1"), in: Self.context(key: true, wanted: true))
        == [.captureSelection, .deliverCommand(id: "c1")])
    #expect(
      SummonPolicy.steps(for: .command(id: "c2"), in: Self.context()) == [
        .clearSelection, .deliverCommand(id: "c2"),
      ])
  }

  @Test(
    "The screenshot shortcut captures, then hands the capture to the page, even over a key panel")
  func screenshotDelivers() {
    #expect(
      SummonPolicy.steps(for: .screenshot, in: Self.context(key: true, wanted: true)) == [
        .captureSelection, .deliverScreenshot,
      ])
    #expect(
      SummonPolicy.steps(for: .screenshot, in: Self.context()) == [
        .clearSelection, .deliverScreenshot,
      ])
    #expect(SummonPolicy.steps(for: .screenshot, in: Self.context(filePanel: true)).isEmpty)
  }

  static let now = Date(timeIntervalSince1970: 1_790_000_000.5)

  @Test("Timestamps match JavaScript's toISOString")
  func timestamp() {
    #expect(CapturedText.timestamp(Self.now) == "2026-09-21T14:13:20.500Z")
  }

  @Test("Whitespace is no selection; the stash keeps the text as read")
  func stash() {
    #expect(TextCapture.stash(nil, at: Self.now) == nil)
    #expect(TextCapture.stash(" \n\t", at: Self.now) == nil)
    #expect(TextCapture.stash(" a ", at: Self.now)?.text == " a ")
  }

  @Test("capture('selection') reports why no text was captured")
  func selectionCapture() {
    #expect(TextCapture.selection(stash: nil, trusted: false) == .failure(.accessibilityNotTrusted))
    #expect(TextCapture.selection(stash: nil, trusted: true) == .failure(.noSelection))
    let ok = CapturedText(text: "hi", capturedAt: Self.now)
    #expect(TextCapture.selection(stash: ok, trusted: false) == .success(ok))
  }

  @Test("The input limit counts UTF-16 units")
  func utf16Limit() {
    // 50 000 emoji are 100 000 UTF-16 units: at the limit.
    let atLimit = CapturedText(text: String(repeating: "😀", count: 50_000), capturedAt: Self.now)
    #expect(TextCapture.selection(stash: atLimit, trusted: true) == .success(atLimit))
    let over = CapturedText(text: atLimit.text + "a", capturedAt: Self.now)
    #expect(TextCapture.selection(stash: over, trusted: true) == .failure(.selectionTooLong))
    #expect(
      TextCapture.clipboard(over.text, at: Self.now) == .failure(.clipboardTooLong))
  }

  @Test("Clipboard and live selection reads need a visible panel")
  func visibility() {
    #expect(
      TextCapture.clipboard("x", at: Self.now, panelVisible: false)
        == .failure(.clipboardPanelHidden))
    #expect(TextCapture.clipboard(" ", at: Self.now) == .failure(.clipboardEmpty))
    #expect(
      TextCapture.liveSelection("x", at: Self.now, panelVisible: false, readable: true)
        == .failure(.selectionPanelHidden))
    #expect(
      TextCapture.liveSelection("x", at: Self.now, panelVisible: true, readable: false)
        == .failure(.liveSelectionUnreadable))
    #expect(
      TextCapture.liveSelection(nil, at: Self.now, panelVisible: true, readable: true)
        == .failure(.liveSelectionMissing))
    #expect(
      CaptureFailure.liveSelectionTooLong.message == "Selected text exceeds the input limit.")
  }
}
