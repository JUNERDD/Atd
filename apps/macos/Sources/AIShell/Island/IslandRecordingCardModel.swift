import AICore
import AppKit
import Observation

/// The recording result card as it runs (architecture R9, R10): its state
/// (``RecordingCardState``: the trim) with what playing adds (the playhead, the step under it,
/// a preview standing in for it), its asking (``asking``: the ask field's text, the answers, the
/// answer slot's height floor) and what the card's views need (the filmstrip's frames). The
/// card and its lightbox (``IslandRecordingLightbox``) are two views of this one model, so a
/// trim, the playhead or a footer's feedback changed in one shows in the other. Their views call
/// it, it applies local changes and requests external work through ``onEvent``; the presenter
/// (``IslandRecording``) re-measures the card when its size changes (``onResize``).
@Observable
final class IslandRecordingCardModel {
  private(set) var state: RecordingCardState
  /// Seconds the playhead is at.
  private(set) var playhead: Double
  private(set) var playing = false
  /// The step under the playhead (``RecordingCardState/step(at:)``), set only when it changes.
  private(set) var currentStep: Int?
  /// The step whose row or mark has the pointer: the two are marked together.
  var hoveredStep: Int?
  /// The handle the arrow keys nudge: the one pressed or dragged last.
  var focusedHandle: RecordingTrim.End?
  /// The filmstrip's frames by slot, filled once made, for ``frameSlots`` slots: as many as the
  /// widest strip showing them asked for (``fillFrames(width:height:scale:)``).
  private(set) var frames: [Int: CGImage] = [:]
  private(set) var frameSlots = 0
  /// Asking about the kept range: a question pauses playback first.
  let asking = IslandAsking<RecordingAsk, RecordingQuickAsk>()
  /// The measured stack's independently bounded preview, answer and notes regions.
  private(set) var layout: IslandMetrics.RecordingCardLayout?
  /// The first measurement is the animation origin; mounting never lays out from zero.
  private(set) var layoutOrigin: IslandMetrics.RecordingCardLayout?
  /// What Save, Copy and Attach report on their buttons (``IslandRecording/cardFeedback(_:_:)``).
  let feedback = IslandShellFeedback<IslandRecording.CardAction>()

  /// One of the card's buttons has the keyboard focus (Full Keyboard Access), so Space presses
  /// it rather than playing (``IslandControlFocus``).
  @ObservationIgnored var controlFocused = false
  /// The trim when a handle was pressed, which its drag moves from; nil between drags.
  @ObservationIgnored private var dragStart: RecordingTrim?
  @ObservationIgnored let playback: IslandRecordingPlayback
  @ObservationIgnored var onEvent: (IslandRecordingEvent) -> Void = { _ in }
  /// Opens the card's lightbox (set by its presenter).
  @ObservationIgnored var openLightbox: () -> Void = {}
  /// The player's frame in the island window's content (SwiftUI's global space there), where the
  /// lightbox grows from and goes back to; nil before the player is laid out.
  @ObservationIgnored var mediaFrame: CGRect?
  /// The card's size may have changed (an answer grew).
  @ObservationIgnored var onResize: () -> Void = {}
  @ObservationIgnored private var framesTask: Task<Void, Never>?
  /// The frames asked for: how many, how tall and at what scale.
  @ObservationIgnored private var requestedFrames = (slots: 0, height: 0.0, scale: 0.0)
  @ObservationIgnored var measuredNotes: (width: Double, height: Double)?

  /// The card for `state`'s recording, playhead at the start of what it keeps.
  init(_ state: RecordingCardState) {
    self.state = state
    playhead = state.trim.start
    playback = IslandRecordingPlayback(movie: state.source.movie)
    playback.onTime = { [weak self] in self?.tick($0) }
    playback.onEnd = { [weak self] in self?.ended() }
    playback.show(playhead)
    currentStep = state.step(at: playhead)
    asking.range = { [weak self] in self?.state.trim }
    asking.willAsk = { [weak self] in self?.pause() }
    asking.onResize = { [weak self] in self?.onResize() }
    asking.onEvent = { [weak self] event in
      switch event {
      case .ask(let ask): self?.onEvent(.ask(ask))
      case .stop(let id): self?.onEvent(.stopAnswer(id))
      case .regenerate(let ask): self?.onEvent(.regenerate(ask))
      case .open(let id): self?.onEvent(.openAnswer(id))
      }
    }
  }

  var source: RecordingCardSource { state.source }

  func setLayout(_ layout: IslandMetrics.RecordingCardLayout) {
    if layoutOrigin == nil { layoutOrigin = layout }
    self.layout = layout
  }

  /// The time the player shows: a preview's, else the playhead's.
  private(set) var preview: Double?

  // MARK: Playback

  func togglePlay() {
    if playing { pause() } else { play() }
  }

  func play() {
    let start = state.playStart(from: playhead)
    playhead = start
    preview = nil
    playing = true
    playback.play(from: start, until: state.trim.end)
    followPlayhead()
  }

  func pause() {
    guard playing else { return }
    playing = false
    playback.pause()
  }

  /// Moves the playhead to `seconds`, pausing.
  func seek(_ seconds: Double) {
    pause()
    playhead = state.clamped(seconds)
    preview = nil
    playback.show(playhead)
    followPlayhead()
  }

  /// The player shows the frame at `seconds` (a hovered step or mark), the playhead staying;
  /// nil goes back to the playhead's frame. Nothing previews while playing.
  func showPreview(_ seconds: Double?) {
    guard !playing else { return }
    preview = seconds.map(state.clamped)
    playback.show(preview ?? playhead)
  }

  /// The pointer entered (`inside`) or left step `index`'s row or dot: the two are marked
  /// together and the player previews its frame. Leaving one step after entering the next
  /// keeps the next one's.
  func hover(step index: Int, _ inside: Bool) {
    guard source.steps.indices.contains(index) else { return }
    if inside {
      hoveredStep = index
      showPreview(source.steps[index].time)
    } else if hoveredStep == index {
      hoveredStep = nil
      showPreview(nil)
    }
  }

  private func tick(_ seconds: Double) {
    guard playing else { return }
    playhead = min(seconds, state.trim.end)
    followPlayhead()
  }

  private func ended() {
    guard playing else { return }
    playing = false
    playhead = state.trim.end
    followPlayhead()
  }

  private func followPlayhead() {
    let step = state.step(at: playhead)
    if step != currentStep { currentStep = step }
  }

  // MARK: Trim

  /// Handle `end` dragged `offset` seconds from where it was when pressed, so a press alone
  /// moves nothing wherever on the handle it lands: the player shows the frame it is on.
  func drag(_ end: RecordingTrim.End, by offset: Double) {
    pause()
    if focusedHandle != end { focusedHandle = end }
    let start = dragStart ?? state.trim
    dragStart = start
    let value = state.setTrim(end, to: (end == .start ? start.start : start.end) + offset)
    preview = value
    playback.show(value)
    keepPlayheadInside()
  }

  /// The handle was let go: the player goes back to the playhead.
  func endDrag() {
    dragStart = nil
    preview = nil
    playback.show(playhead)
  }

  /// The focused handle moved by an arrow key (``RecordingCardState/nudge(shift:)``); false
  /// with no handle focused.
  func nudge(forward: Bool, shift: Bool) -> Bool {
    guard let end = focusedHandle else { return false }
    pause()
    let step = RecordingCardState.nudge(shift: shift)
    let value = state.nudge(end, by: forward ? step : -step)
    preview = value
    playback.show(value)
    keepPlayheadInside()
    return true
  }

  /// One end of the kept range moves to the playhead (I and O in the lightbox), as far as the
  /// shortest range lets it; the playhead stays inside.
  func trimAtPlayhead(_ end: RecordingTrim.End) {
    pause()
    state.setTrim(end, to: playhead)
    preview = nil
    keepPlayheadInside()
    playback.show(playhead)
  }

  /// "还原": the whole recording is kept again.
  func resetTrim() {
    state.resetTrim()
    preview = nil
    playback.show(playhead)
  }

  private func keepPlayheadInside() {
    playhead = min(max(playhead, state.trim.start), state.trim.end)
    followPlayhead()
  }

  // MARK: Showing

  /// The card shows (again): its answer slot as short as its answer.
  func reopen() {
    asking.answerFloor = 0
    layout = nil
    preview = nil
    controlFocused = false
  }

  /// The player's natural size before a short work area fits the complete card.
  var preferredPlayer: WindowSize {
    IslandMetrics.recordingPlayer(aspect: source.aspect, in: IslandMetrics.recordingPlayerRoom)
  }

  // MARK: Frames

  /// A filmstrip `width` points wide and `height` tall at `scale` shows the frames: the card's
  /// and the lightbox's larger one share them, so they are made again only when a strip needs
  /// more, taller or sharper frames than those asked for; a strip with fewer cells shows those
  /// nearest its own (``frame(at:)``).
  func fillFrames(width: Double, height: Double, scale: Double) {
    let slots = IslandMetrics.recordingFilmSlots(width: width, aspect: source.aspect, film: height)
    let held = requestedFrames
    guard slots > held.slots || height > held.height || scale > held.scale else { return }
    let request = (
      slots: max(slots, held.slots), height: max(height, held.height),
      scale: max(scale, held.scale)
    )
    requestedFrames = request
    framesTask?.cancel()
    let source = source
    framesTask = Task { [weak self] in
      let frames = await IslandRecordingFrames.make(
        movie: source.movie, duration: source.duration, count: request.slots,
        height: request.height, aspect: source.aspect, scale: request.scale)
      guard let self, !Task.isCancelled, requestedFrames == request else { return }
      // Publish the new sampling and its slot count together; keep the complete old strip
      // while decoding so expanding never introduces empty cells or mismatched timestamps.
      self.frames = frames
      frameSlots = request.slots
    }
  }

  /// The filmstrip frame nearest `seconds` and the time it shows; nil before one is made.
  func frame(at seconds: Double) -> (image: CGImage, time: Double)? {
    guard frameSlots > 0 else { return nil }
    let share = source.duration / Double(frameSlots)
    let slot = min(max(Int(seconds / share), 0), frameSlots - 1)
    return frames[slot].map { ($0, (Double(slot) + 0.5) * share) }
  }

  /// Updates the folder name shown in Save tooltips when preferences change.
  func updateSaveFolder(_ folderName: String?) {
    guard state.source.saveFolder != folderName else { return }
    state.setSaveFolder(folderName)
  }

  /// The card went for good: playback and frame making stop.
  func close() {
    pause()
    playback.close()
    framesTask?.cancel()
  }
}

/// A layer keeps the card it shows (``IslandLayer/shellCard``): one card is one model.
extension IslandRecordingCardModel: Equatable {
  static func == (lhs: IslandRecordingCardModel, rhs: IslandRecordingCardModel) -> Bool {
    lhs === rhs
  }
}
