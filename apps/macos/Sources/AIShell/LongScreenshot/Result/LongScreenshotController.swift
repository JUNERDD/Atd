import AICore
import AppKit

/// The shell's long screenshot after its capture (decisions D8, D11, D12): it turns the capture
/// session's finished ``LongScreenshotImage`` into the island's result card and performs what
/// the card asks for.
///
/// - Show: the island's processing capsule while the image's text is recognized in tiles and its
///   sensitive parts found (``LongScreenshotText``), then the card of that
///   ``LongScreenshotCardSource``.
/// - Footer: Copy puts the kept image on the clipboard at full pixels; Attach imports it with its
///   context into the panel's composer (``LongScreenshotController+Actions``). Annotating happens
///   on the island, in the card's lightbox, and only changes what the kept image holds.
/// - Asks: each runs as a light task on the panel's page with the kept image and its context
///   (`recording.ask` with the `screenshot` source), whose answer the card shows as it grows
///   (``LongScreenshotController+Asks``).
/// - Text commands: the full-screen preview runs them on the image's text through the screenshot
///   capability's runner, with the files and copies made here (``LongScreenshotController+Text``).
///
/// Nothing outlives the card: its close, or the next long screenshot, stops its asks and drops
/// its state; the files of each export live only until their import answered
/// (``LongScreenshotFiles``). Every continuation that waited checks ``generation`` first, so a
/// late one drops what it got instead of showing it on the next long screenshot's card.
final class LongScreenshotController: LongScreenshotResults {
  /// A footer action of the result card.
  typealias CardAction = IslandLongScreenshot.CardAction

  let island: IslandLongScreenshot
  let arbiter: DeviceArbiter
  let attachments: AttachmentImporter
  let panelHost: WebViewHost
  let showPanel: () -> Void
  /// The screenshot capability, whose text commands, options and runner the full-screen
  /// preview's text commands use (``textServices``); the shell sets it, and without it the
  /// preview offers Copy alone.
  weak var screenshots: ScreenshotTaker?

  /// What the card shows; nil before the text is read and once the card went.
  var source: LongScreenshotCardSource?
  /// Bumped by every new long screenshot. A close leaves it: a copy or an attach already pressed
  /// still goes through, only its button's feedback has nowhere to show.
  private(set) var generation = 0
  private var reading: Task<Void, Never>?

  /// Files being prepared by ask ID; cancelled on Stop, close or document unload.
  var preparingAsks: [String: Task<Void, Never>] = [:]
  /// Sent asks and their latest text, ended explicitly if their renderer document goes away.
  var runningAsks: [String: String] = [:]
  var exportingActions: Set<CardAction> = []

  init(
    island: IslandLongScreenshot, arbiter: DeviceArbiter, attachments: AttachmentImporter,
    panelHost: WebViewHost, showPanel: @escaping () -> Void
  ) {
    self.island = island
    self.arbiter = arbiter
    self.attachments = attachments
    self.panelHost = panelHost
    self.showPanel = showPanel
    island.onEvent = { [weak self] in self?.handle($0) }
    island.textServices = textServices
  }

  // MARK: Showing

  /// A finished long screenshot: the processing capsule while its text is read, then its card.
  /// A card still up for an earlier one goes first.
  func show(_ shot: LongScreenshotImage) {
    drop()
    generation += 1
    let generation = generation
    island.showProcessing()
    reading = Task { [weak self] in
      let text = await LongScreenshotText.read(shot.image, scale: shot.scale)
      guard let self, generation == self.generation else { return }
      reading = nil
      let source = LongScreenshotCardSource(
        id: UUID().uuidString, shot: shot, lines: text.lines, sensitive: text.sensitive)
      self.source = source
      island.showResult(source)
    }
  }

  /// The card went (its close button, Escape, an attached edit), or another long screenshot
  /// replaces it: its asks stop and its state goes with it.
  func drop() {
    reading?.cancel()
    reading = nil
    cancelAsks()
    exportingActions.removeAll()
    guard source != nil else { return }
    source = nil
    island.forgetCard()
  }

  // MARK: Events

  /// What the card asks for.
  private func handle(_ event: LongScreenshotCardEvent) {
    switch event {
    case .ask(let ask), .regenerate(let ask): send(ask)
    case .stopAnswer(let askID): stopAsk(askID)
    case .openAnswer(let askID): panelHost.send(.recordingAskOpen(.init(askId: askID)))
    case .copy(let kept): copy(kept)
    case .attach(let kept): attach(kept)
    case .close: drop()
    }
  }

  static func text(_ key: LongScreenshotResultStringKey) -> String {
    ShellStrings.shared.text(key)
  }
}
