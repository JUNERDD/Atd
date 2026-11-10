import AICore
import AppKit

/// The shell's presenters that put their own content on the island over the page's progress
/// (decision D13): the screen recording (``IslandRecording``) and the long screenshot
/// (``IslandLongScreenshot``). They take the one shell place in turn, so one shell card shows at
/// a time.
enum IslandShellOwner {
  case recording, longScreenshot
}

/// The island's one owner shares it with the shell's own content (architecture R7,
/// ``CommandProgressState/Recording``): the screen recording's and the long screenshot's. The
/// recording's capsule, its processing and its discard confirmation hold the island: whatever
/// the page shows meanwhile (and a command shortcut's press capsule) goes into the state without
/// drawing, its keys (Escape, the answer card's write keys) are let go, and it draws as soon as
/// the hold ends, taking its keys and starting the time it goes by itself after; when the shell
/// goes on to its result card, that progress replaces the card. The shell's results (a result
/// card, a finished status) and the long screenshot's processing only yield the island: the
/// page's next show replaces them, which each presenter hears (``IslandRecording/replaced()``,
/// ``IslandLongScreenshot/replaced()``). A long screenshot takes the island only from an answer
/// card (``islandTaken``); otherwise its card waits, as a replaced one does, and comes back
/// when the island would leave (``exitIsland()``), without taking the keyboard.
///
/// One presenter's content taking the island replaces the other's, the same way. Every draw of
/// the page's progress goes through ``progressMayShow()`` or ``drawProgress()``, and
/// ``sync(leavingCard:)`` takes no keys while the shell is on the island. The island gives up the
/// keyboard only while the reservation still stands, so the resign-key handler never takes an
/// options card waiting in the state for one on screen that lost the keyboard.
extension CommandProgressController {
  /// `owner` puts `content` on the island, holding it (`holding`) or yielding it to the page's
  /// next show; the other presenter's content goes. Keyboard ownership is settled before the
  /// content morphs in: a result card takes the keyboard unless it is not `takingKeyboard` (it
  /// came back by itself, so the keyboard stays where the person is typing until they click
  /// it). False when this ends a hold under which the page showed something: that progress draws
  /// instead of `content`.
  func showShell(
    _ content: IslandContent, by owner: IslandShellOwner, holding: Bool, inPlace: Bool = false,
    takingKeyboard: Bool = true
  ) -> Bool {
    switch owner {
    case .recording: longScreenshot.replaced()
    case .longScreenshot: recording.replaced()
    }
    guard state.showRecording(holding: holding) else {
      drawProgress()
      sync(leavingCard: nil)
      expire()
      return false
    }
    // Reserve the island before changing focus, so the resign-key callback cannot cancel
    // hidden command options. Take the result's keyboard before show starts its morph:
    // makeKey synchronously updates native focus and glass and can block a frame's commit.
    let card = [.recordingResult, .longScreenshotResult].contains(content.kind)
    island.setKeyCapable(card, taking: takingKeyboard)
    yieldKeys()
    island.show(content, inPlace: inPlace)
    // A hidden island could not take focus yet. Its entrance is still at its prepared,
    // transparent starting frame; appear starts the spring on the next run-loop turn.
    if card, takingKeyboard, !island.window.isKeyWindow { island.setKeyCapable(true) }
    return true
  }

  /// The shell's content leaves the island: what the page shows draws again (taking its keys
  /// back), or the island leaves.
  func releaseShell() {
    guard !state.drawsProgress else { return }
    island.setKeyCapable(false)
    state.releaseRecording()
    drawProgress()
    sync(leavingCard: nil)
    expire()
  }

  /// The page's progress (or a command shortcut's press) arrives: whether it may draw now. It
  /// waits under holding shell content; it replaces yielding content, whose presenter is told.
  func progressMayShow() -> Bool {
    if state.recordingYields { island.setKeyCapable(false) }
    switch state.progressArrives() {
    case .draws: return true
    case .waits: return false
    case .replacesRecording:
      recording.replaced()
      longScreenshot.replaced()
      return true
    }
  }

  /// Draws what the state shows, or takes the island away when it shows nothing; nothing
  /// while the shell is on the island, which draws what the state shows once it goes.
  func drawProgress() {
    guard state.drawsProgress else { return }
    if let shown = state.shown { island.show(content(shown.phase)) } else { exitIsland() }
  }

  /// The island has nothing of the page's to show: a long screenshot card that waited comes back
  /// in its place (``IslandLongScreenshot/resumeIfWaiting()``), or the island leaves.
  func exitIsland() {
    if longScreenshot.resumeIfWaiting() { return }
    island.exit()
  }

  /// What is on the island keeps it from the long screenshot, which waits for it to go: the
  /// recording's content, a command shortcut's press, or the page's progress, unless that is an
  /// answer card (the review card included). An answer card stays until it is acted on, so it
  /// waits instead, in the state, and draws again once the long screenshot's content goes. A run
  /// working would replace the card with its next update at once, and the outcomes that go by
  /// themselves (done, copied, a notice) are gone within seconds.
  var islandTaken: Bool {
    guard recording.showing == nil else { return true }
    guard state.drawsProgress else { return false }
    return pressing || (state.shown != nil && !state.isAnswering)
  }

  /// While the shell is on the island the page's progress holds no keys: Escape and the answer
  /// card's write keys go, and the answer card stops following the focus.
  func yieldKeys() {
    if let token = escape {
      keys.unregister(token)
      escape = nil
    }
    holdWriteKeys(nil)
    answerFocus.stop()
  }

  /// A shell card has the keyboard: a shortcut pressed now only closes it.
  var shellCardHasKeyboard: Bool { recording.cardHasKeyboard || longScreenshot.cardHasKeyboard }

  /// A shortcut was pressed while a shell card had the keyboard: it closes.
  func closeShellCard() {
    recording.closeCard()
    longScreenshot.closeCard()
  }

  /// A key press while the shell is on the island: its card reads it.
  func shellKey(_ event: NSEvent) -> Bool {
    recording.key(event) || longScreenshot.key(event)
  }

  /// A key equivalent while the shell is on the island: its card's footer shortcuts.
  func shellKeyEquivalent(_ event: NSEvent) -> Bool {
    recording.keyEquivalent(event) || longScreenshot.keyEquivalent(event)
  }
}
