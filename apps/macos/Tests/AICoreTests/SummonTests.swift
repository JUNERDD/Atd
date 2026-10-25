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
    #expect(SummonTrigger(hotKeyID: "panel") == .command(CommandLaunch(id: "panel")))
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
      SummonPolicy.steps(for: .command(CommandLaunch(id: "c1")), in: Self.context(filePanel: true))
        .isEmpty)
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

  @Test("A command captures, records its write target unless the panel is key, then delivers")
  func commandDelivers() {
    #expect(
      SummonPolicy.steps(
        for: .command(CommandLaunch(id: "c1")), in: Self.context(key: true, wanted: true))
        == [.captureSelection, .deliverCommand(CommandLaunch(id: "c1"))])
    #expect(
      SummonPolicy.steps(for: .command(CommandLaunch(id: "c1")), in: Self.context(wanted: true))
        == [
          .captureSelection, .captureTarget, .deliverCommand(CommandLaunch(id: "c1")),
        ])
    #expect(
      SummonPolicy.steps(for: .command(CommandLaunch(id: "c2")), in: Self.context()) == [
        .clearSelection, .captureTarget, .deliverCommand(CommandLaunch(id: "c2")),
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

  @Test("Ask Atd always captures, then shows the panel and has the page quote the stash")
  func askCapturesAndShows() {
    for context in [Self.context(), Self.context(key: true, wanted: true)] {
      #expect(
        SummonPolicy.steps(for: .ask, in: context) == [
          .captureSelection, .showPanel, .deliverAsk,
        ])
    }
    #expect(SummonPolicy.steps(for: .ask, in: Self.context(filePanel: true)).isEmpty)
  }

  @Test("A toolbar command captures even when no shortcut wants the selection")
  func toolbarCommandCaptures() {
    #expect(
      SummonPolicy.steps(for: .toolbarCommand(CommandLaunch(id: "c1")), in: Self.context()) == [
        .captureSelection, .captureTarget, .deliverCommand(CommandLaunch(id: "c1")),
      ])
    #expect(
      SummonPolicy.steps(for: .toolbarCommand(CommandLaunch(id: "c1")), in: Self.context(key: true))
        == [
          .captureSelection, .deliverCommand(CommandLaunch(id: "c1")),
        ])
    #expect(
      SummonPolicy.steps(
        for: .toolbarCommand(CommandLaunch(id: "c1")), in: Self.context(filePanel: true)
      )
      .isEmpty)
  }

  static func facts(
    trusted: Bool = true, available: Bool = true, secure: Bool = false, selection: Bool = true
  ) -> TextWriteFacts {
    TextWriteFacts(
      trusted: trusted, targetAvailable: available, secureInput: secure, hasSelection: selection)
  }

  @Test("A write-back refuses in the contract's order, and only selection modes need a selection")
  func writeRefusals() {
    let none = Self.facts(trusted: false, available: false, secure: true, selection: false)
    #expect(TextWritePlan.refusal(.selection, none) == .notTrusted)
    #expect(
      TextWritePlan.refusal(.selection, Self.facts(available: false, secure: true)) == .targetGone)
    #expect(
      TextWritePlan.refusal(.cursor, Self.facts(secure: true, selection: false)) == .secureInput)
    #expect(TextWritePlan.refusal(.afterSelection, Self.facts(selection: false)) == .noSelection)
    #expect(TextWritePlan.refusal(.cursor, Self.facts(selection: false)) == nil)
    #expect(TextWritePlan.refusal(.selection, Self.facts()) == nil)
  }

  @Test("Text after a selection follows a space, or a blank line after a multi-line selection")
  func writeSeparator() {
    #expect(TextWritePlan.insertion(of: "B", mode: .selection, selectedText: "a\nb") == "B")
    #expect(TextWritePlan.insertion(of: "B", mode: .cursor, selectedText: nil) == "B")
    #expect(TextWritePlan.insertion(of: "B", mode: .afterSelection, selectedText: "a") == " B")
    #expect(TextWritePlan.insertion(of: "B", mode: .afterSelection, selectedText: nil) == " B")
    #expect(
      TextWritePlan.insertion(of: "B", mode: .afterSelection, selectedText: "a\r\nb") == "\n\nB")
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

  @Test("A command without options summons on the press; one with options waits for the hold")
  func holdPress() {
    var hold = CommandHold()
    #expect(hold.press(id: "plain", offersOptions: false) == .summon)
    #expect(!hold.isHolding)
    #expect(hold.press(id: "tone", offersOptions: true) == .hold(generation: 1))
    #expect(hold.isHolding)
    // Another shortcut with options, or a repeat, waits for the first hold to decide; one
    // without options still summons, as it always has.
    #expect(hold.press(id: "tone", offersOptions: true) == .ignore)
    #expect(hold.press(id: "other", offersOptions: true) == .ignore)
    #expect(hold.press(id: "plain", offersOptions: false) == .summon)
  }

  @Test("Any shortcut pressed while the options card is open only closes it")
  func holdClosesCard() {
    var hold = CommandHold()
    #expect(hold.press(id: "tone", offersOptions: true, cardOpen: true) == .closeCard)
    #expect(hold.press(id: "plain", offersOptions: false, cardOpen: true) == .closeCard)
    #expect(hold.press(id: "togglePanel", offersOptions: false, cardOpen: true) == .closeCard)
    // Nothing was held: the release does nothing, and the next press holds as usual.
    #expect(!hold.isHolding && hold.release(id: "tone") == nil)
    #expect(hold.press(id: "tone", offersOptions: true) == .hold(generation: 1))
  }

  @Test("A release before the threshold runs; the threshold while held chooses, once")
  func holdDecides() {
    var hold = CommandHold()
    #expect(CommandHold.threshold == .milliseconds(300))
    #expect(CommandHold.pageWait == .milliseconds(600))
    guard case .hold(let tap) = hold.press(id: "tone", offersOptions: true) else {
      Issue.record("expected a hold")
      return
    }
    #expect(hold.release(id: "other") == nil)
    #expect(hold.release(id: "tone") == .run)
    // The tap's threshold timer finds nothing to decide.
    #expect(hold.elapse(generation: tap) == nil)
    guard case .hold(let held) = hold.press(id: "tone", offersOptions: true) else {
      Issue.record("expected a hold")
      return
    }
    #expect(held == tap + 1)
    #expect(hold.elapse(generation: tap) == nil)
    #expect(hold.elapse(generation: held) == .choose)
    // The release after the card opened does nothing.
    #expect(hold.release(id: "tone") == nil)
    #expect(!hold.isHolding)
  }

  @Test("A hold whose summon did not start is dropped without a decision")
  func holdDropped() {
    var hold = CommandHold()
    guard case .hold(let generation) = hold.press(id: "tone", offersOptions: true) else {
      Issue.record("expected a hold")
      return
    }
    hold.drop(generation: generation + 1)
    #expect(hold.isHolding)
    hold.drop(generation: generation)
    #expect(!hold.isHolding)
    #expect(hold.release(id: "tone") == nil)
    #expect(hold.elapse(generation: generation) == nil)
    #expect(hold.press(id: "tone", offersOptions: true) == .hold(generation: generation + 1))
  }

  @Test("A held launch hands its intent to the page; a plain run leaves it out")
  func launchIntent() {
    let target = ShortcutCommandEvent.Target(
      id: "t", app: "Notes", writable: true, selectionKind: nil)
    #expect(CommandLaunch(id: "c").event(target: target).intent == nil)
    #expect(CommandLaunch(id: "c", intent: .choose).event(target: target).intent == .choose)
  }
}
