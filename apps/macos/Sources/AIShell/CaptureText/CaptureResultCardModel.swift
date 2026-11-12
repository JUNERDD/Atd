import AICore
import AppKit
import Observation

/// What the result card asks its host to do (the capture editor, the long screenshot's full-screen
/// preview). The card changes its own presentation (closing, opening again) before it says so; everything that touches the run, the image or the clipboard is the host's.
enum CaptureResultAction: Equatable {
  /// Stop run `runId` (Escape while it runs, or while it makes another version).
  case stop(runId: String)
  /// The card of run `runId` closed (its ×, Escape once settled): it went.
  case closed(runId: String)
  /// A footer action of run `runId`'s card: Restore, Copy (also ⌘C), Copy Screenshot, Open in
  /// Atd, Insert or Apply (also ⌘↩).
  case perform(CaptureResultCard.Action, runId: String)
  /// The long screenshot's summary row's Restore: every AI change on the image goes, as one undo
  /// step (D5).
  case revertAll
  /// Run `runId`'s card opened again (``CaptureResultCardModel/reopen(_:lighting:)``).
  case reopened(runId: String)
  /// The pointer entered item `item` of run `runId`'s card, or left the items (nil): its badge
  /// lights with it.
  case hover(item: Int?, runId: String)
  /// Item `item` was clicked: its badge flashes and, in the long screenshot, the image scrolls to
  /// its paragraph.
  case pick(item: Int, runId: String)
  /// Versions: show version `version` of run `runId`'s answer.
  case version(Int, runId: String)
  /// Versions: make another version.
  case regenerate(runId: String)
  /// Versions: make another version with what the card staged.
  case adjust(CaptureTextActionEvent.Adjust, runId: String)
  /// Review: nothing goes onto the image; the card closed.
  case discard(runId: String)
  /// The grabber moved the card by this much since the drag began.
  case move(CGSize)
  /// The grabber was released.
  case moveEnded
}

/// The screenshot text command's result card as its host shows it: one card at a time (decision
/// D8), its content derived from the latest run (``CaptureResultCard``). The host feeds it the
/// card (and, in the long screenshot, the summary of what the runs left on the image) as they
/// change and handles what it asks (``CaptureResultAction``).
///
/// Its content shows in one of two containers. Floating (the capture editor, in its overlay), it
/// is a card of its own that collapses into the island's copied capsule for
/// ``CommandProgressState/doneDuration`` after a copy and then goes, as its × and Escape let it
/// go; a click on its result on the image opens it again (``reopen(_:lighting:)``).
/// ``CaptureResultCardView`` draws it at ``size``, which the host places
/// (``CaptureResultPlacement``). Not floating (the long screenshot's full-screen preview, in its
/// side panel), the container lays the content out itself, so the model never measures it and
/// the host never collapses or closes it.
@Observable
final class CaptureResultCardModel {
  enum Presentation: Equatable {
    case hidden
    case card
    /// The copied capsule, saying this.
    case copied(String)
  }

  private(set) var presentation = Presentation.hidden
  /// The latest run's card, kept once it closes so a click on its result can open it again.
  private(set) var card: CaptureResultCard?
  /// What the runs left on the image, which the long screenshot's summary row sums up
  /// (``CaptureTextRuns/summary(in:)``).
  private(set) var dock = CaptureTextDockSummary()
  /// The size the presentation takes, for the host to place it; zero while hidden.
  private(set) var size = CGSize.zero
  /// The least height the host may cut the card to where it places it, its body scrolling
  /// (``CaptureResultMeasure/size(of:)``).
  private(set) var minimumHeight: CGFloat = 0
  /// The item whose badge is lit: hovered on the card, or on the image (the host sets it then).
  var hotItem: Int?
  /// The items whose place the host's media shows now (the long screenshot's viewer), marked as
  /// the recording's steps mark the playhead's, subdued; the capture editor never sets it.
  var inView: Set<Int> = []
  /// What the card's adjust field and chosen adjustments staged for the next version, kept while
  /// one run's card shows.
  var review = ReviewDraft()
  /// The person paged back to a version made while another is being made; otherwise the card
  /// shows the one being made, its newest page (``CaptureResultCard/draft``), from the moment it
  /// begins. It ends with that version, and when the card opens again (its command run again on
  /// the same text asks for another).
  private(set) var pagedBack = false
  /// The app Insert writes into, named in its tooltip.
  var insertApp: String?
  /// The colour of the step markers the run draws, which the items' badges take.
  var stepColor = AnnotationColor.red
  var reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  /// The tallest the card may be where its host shows it (the capture editor's display's visible
  /// height); past it, as past the island's largest shape, its body scrolls.
  var heightLimit = CGFloat.infinity {
    didSet { if heightLimit != oldValue { measure() } }
  }
  private(set) var labels = CaptureResultLabels.current()
  /// The scheme the card keeps whatever the app's is (the full-screen preview's dark one); nil
  /// follows the app's.
  let dark: Bool?
  /// The card floats on its own glass and is measured for its host to place.
  let floating: Bool

  @ObservationIgnored var onAction: (CaptureResultAction) -> Void = { _ in }
  @ObservationIgnored private var collapse: Task<Void, Never>?
  @ObservationIgnored private var observer: (any NSObjectProtocol)?

  init(dark: Bool? = nil, floating: Bool = true) {
    self.dark = dark
    self.floating = floating
    observer = NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.labels = .current()
        self?.measure()
      }
    }
  }

  isolated deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    collapse?.cancel()
  }

  // MARK: The host

  /// A new run's card: it replaces whatever showed (the old run's marks stay on the image) and
  /// opens. Its review draft starts empty.
  func show(_ card: CaptureResultCard) {
    if card.run != self.card?.run { review = ReviewDraft() }
    self.card = card
    pagedBack = false
    hotItem = nil
    inView = []
    present(.card)
  }

  /// The same run's card as it moved on: the content changes, the presentation stays (a closed
  /// card stays closed). A card for another run is ``show(_:)``'s.
  func update(_ card: CaptureResultCard) {
    guard card.run == self.card?.run else { return show(card) }
    guard card != self.card else { return }
    self.card = card
    if card.draft == nil { pagedBack = false }
    measure()
  }

  /// A run's card opened again (its badge or result on the image clicked, its command run again on
  /// the same text), with item `item` lit: another run's card replaces the one that showed
  /// (decision D8, one card at a time); the same run's card, closed or collapsed, opens.
  func reopen(_ card: CaptureResultCard, lighting item: Int? = nil) {
    guard card.run == self.card?.run else {
      show(card)
      hotItem = item
      return
    }
    update(card)
    pagedBack = false
    hotItem = item
    present(.card)
    onAction(.reopened(runId: card.run))
  }

  /// What the runs left on the image now, for the long screenshot's summary row.
  func setDock(_ summary: CaptureTextDockSummary) {
    if summary != dock { dock = summary }
  }

  /// Collapses into the copied capsule saying `text` (``CaptureResultLabels/copied``,
  /// ``CaptureResultLabels/copiedScreenshot(size:)``, ``CaptureResultLabels/copiedText(_:)``),
  /// which goes after ``CommandProgressState/doneDuration``.
  func collapse(copied text: String) {
    present(.copied(text))
    collapse = Task { [weak self] in
      try? await Task.sleep(for: CommandProgressState.doneDuration)
      guard !Task.isCancelled, let self, case .copied = presentation else { return }
      present(.hidden)
    }
  }

  /// The surface ended: nothing shows and nothing is kept.
  func reset() {
    card = nil
    dock = CaptureTextDockSummary()
    review = ReviewDraft()
    hotItem = nil
    inView = []
    present(.hidden)
  }

  // MARK: Keys

  /// Escape: stops a running run (or the version it is making), else closes the card (a review's
  /// discards); false when no card shows, so the key goes on.
  func escape() -> Bool {
    guard presentation == .card, let card else { return false }
    if card.busy {
      onAction(.stop(runId: card.run))
    } else if card.reviewing {
      discard()
    } else {
      close()
    }
    return true
  }

  /// ⌘C: the card's Copy, when it shows and has something to copy.
  func copyKey() -> Bool {
    guard presentation == .card, let card, card.actions.contains(.copy), !card.busy,
      card.copyText != nil
    else { return false }
    onAction(.perform(.copy, runId: card.run))
    return true
  }

  /// ⌘↩: a review's Apply, or Insert when the card offers it.
  func primaryKey() -> Bool {
    guard presentation == .card, let card, !card.busy, let primary = card.primary,
      primary == .apply || primary == .insert
    else { return false }
    onAction(.perform(primary, runId: card.run))
    return true
  }

  // MARK: The card's controls

  func perform(_ action: CaptureResultCard.Action) {
    guard let card, !card.busy else { return }
    onAction(.perform(action, runId: card.run))
  }

  /// The header button's × and Escape: the card goes, its results staying on the image, where a
  /// click on one opens it again (``reopen(_:lighting:)``).
  func close() {
    guard let card else { return }
    present(.hidden)
    onAction(.closed(runId: card.run))
  }

  /// A review's × or Escape: nothing goes onto the image.
  func discard() {
    guard let card else { return }
    present(.hidden)
    onAction(.discard(runId: card.run))
  }

  /// The pointer entered item `item` (`inside`) or left it; leaving one it is no longer on (it
  /// went on to the next) changes nothing.
  func hover(_ item: Int, inside: Bool) {
    let next = inside ? item : hotItem == item ? nil : hotItem
    guard let card, next != hotItem else { return }
    hotItem = next
    onAction(.hover(item: next, runId: card.run))
  }

  func pick(_ item: Int) {
    guard let card else { return }
    onAction(.pick(item: item, runId: card.run))
  }

  /// Versions: shows page `page` of the pager, also while a version is being made: a version
  /// made (the host shows it, `version`, unless it shows already), or the one being made after
  /// them.
  func version(_ page: Int) {
    guard let card, let versions = card.versions, (1...versions.pages).contains(page),
      page != self.page(of: versions)
    else { return }
    if versions.drafting {
      pagedBack = page <= versions.count
      measure()
    } else if page == versions.version {
      return
    }
    // While a version is made, every turn goes to the host, the draft's page (`count + 1`) and a
    // return to the version it shows included: where the card lands once the version settles
    // follows the page the person was on last.
    onAction(.version(page, runId: card.run))
  }

  /// Versions: makes another version, while the run may have one more.
  func regenerate() {
    guard let card, card.versions?.takesVersion == true else { return }
    onAction(.regenerate(runId: card.run))
  }

  /// Sends the staged adjustment, when there is one and the run may have one more version.
  func sendAdjustment() {
    guard let card, card.versions?.takesVersion == true, let adjust = review.adjust else { return }
    review = ReviewDraft()
    onAction(
      .adjust(
        CaptureTextActionEvent.Adjust(
          text: adjust.text, adjustments: adjust.adjustments, arguments: adjust.arguments),
        runId: card.run))
  }

  private func present(_ next: Presentation) {
    if case .copied = next {} else { collapse?.cancel() }
    presentation = next
    measure()
  }

  /// Sizes the presentation as ``CaptureResultCardView`` draws it, when it floats.
  private func measure() {
    guard floating else { return }
    let (next, least) = CaptureResultMeasure.size(of: self)
    if least != minimumHeight { minimumHeight = least }
    if next != size { size = next }
  }
}
