import AICore
import AppKit

/// The shell's screen recording (architecture R1, R5–R11): it takes over a capture session's
/// record-mode selection (``CaptureRecording``) once the overlays are gone and runs everything up
/// to the result.
///
/// - Start: the recording's own claim (`.user(.screenRecording)`, which leaves the user's other
///   features free and refuses background computer use), the remembered settings
///   (``RecordingSettingsMemory``) mapped onto a ``RecordingConfig``, the microphone's
///   permission, the corner marks and the countdown, which Escape and ⌃⌘Esc cancel; then the
///   ``ScreenRecorder``.
/// - Recording: the island's capsule and the menu bar timer follow the recorder's live state;
///   pause, discard (confirmed on the island) and stop (the capsule, the timer's menu, ⌃⌘Esc) come
///   from either, the microphone toggle from the capsule (``ScreenRecordingController+Live``).
/// - After: the processing capsule, ``RecordingProcessor``, the after-recording action, and the
///   result card's actions and asks (``ScreenRecordingController+Result``).
///
/// Every continuation that waited checks ``generation`` first: a discard, a quit or the next
/// recording makes a late one drop what it got instead of showing it.
final class ScreenRecordingController: CaptureRecording {
  enum Stage: Equatable {
    case idle
    /// Holding the claim: the microphone's permission, then the countdown.
    case countingDown
    /// The recorder's start is under way.
    case starting
    /// Recording or paused, the discard confirmation included.
    case recording
    /// Stopped: the take finishing, being processed, then saved or attached as the settings say.
    case processing
  }

  /// What the island shows while recording.
  enum Face: Equatable {
    case capsule
    case discard
    /// A short note (a microphone that could not turn on) until the capsule comes back.
    case note(until: ContinuousClock.Instant)
  }

  /// Set here, and back to idle by the result's handling once it is done.
  var stage = Stage.idle
  var isBusy: Bool { stage != .idle }
  /// Bumped by every begin, cancel and quit.
  private(set) var generation = 0

  let island: IslandRecording
  let arbiter: DeviceArbiter
  let attachments: AttachmentImporter
  let panelHost: WebViewHost
  let showPanel: () -> Void
  let defaults: UserDefaults
  private let screenAccess: ScreenRecordingTrust

  /// The settings the recording began with; the record bar saves every change at once.
  var settings = RecordingSettings.defaults
  var recorder: ScreenRecorder?
  let marks = RecordingCornerMarks()
  let statusItem = RecordingStatusItem()
  private let countdown = RecordingCountdownOverlay()
  private let keys = RecordingStopKeys()
  private var claim: ResourceClaim?
  private var countdownTask: Task<Void, Never>?

  // The live recording (``ScreenRecordingController+Live``).
  var face = Face.capsule
  var live = RecordingLiveState(
    elapsed: 0, isPaused: false, microphoneLevel: 0, isMicrophoneOn: false)
  /// The microphone recorded now; nil while it is off.
  var microphone: RecordingMicrophone?
  /// The microphone the capsule's toggle would turn on, by name.
  var switchName: String?
  /// The discard confirmation paused the recording, so Keep Recording resumes it.
  var pausedForDiscard = false
  var switchingMicrophone = false

  // The result (``ScreenRecordingController+Result``).
  var kept: RecordingKept?
  /// Media preparation by ask ID; cancelled on Stop, replacement or document unload.
  var preparingAsks: [String: Task<Void, Never>] = [:]
  /// Sent asks and their latest text, ended explicitly if their renderer document goes away.
  var runningAsks: [String: String] = [:]
  var exportingActions: Set<IslandRecording.CardAction> = []

  init(
    island: IslandRecording, arbiter: DeviceArbiter, attachments: AttachmentImporter,
    panelHost: WebViewHost, screenAccess: ScreenRecordingTrust,
    defaults: UserDefaults = .standard, showPanel: @escaping () -> Void
  ) {
    self.island = island
    self.arbiter = arbiter
    self.attachments = attachments
    self.panelHost = panelHost
    self.screenAccess = screenAccess
    self.defaults = defaults
    self.showPanel = showPanel
    island.onEvent = { [weak self] in self?.handle($0) }
    statusItem.onEvent = { [weak self] in self?.handle($0) }
    keys.onStop = { [weak self] in self?.stop() }
    keys.onEscape = { [weak self] in
      if self?.stage == .countingDown { self?.cancel() }
    }
  }

  // MARK: Starting

  func begin(_ request: CaptureRecordRequest) {
    guard stage == .idle else { return }
    do {
      claim = try arbiter.tryClaim([.interactiveScreen], owner: .user(.screenRecording))
    } catch {
      island.showStatus(Self.text(.screenBusy), kind: .failed)
      return
    }
    dropLastRecording()
    generation += 1
    stage = .countingDown
    settings = RecordingSettingsMemory.load(from: defaults)
    let generation = generation
    countdownTask = Task { [weak self] in await self?.countDown(request, generation: generation) }
  }

  /// The microphone's permission first, so its prompt never cuts into the countdown; a refusal
  /// records without it. Then the corner marks and the countdown around the region.
  private func countDown(_ request: CaptureRecordRequest, generation: Int) async {
    var microphone = settings.microphone(among: RecordingMicrophones.available())
    if microphone != nil {
      do throws(RecordingError) {
        try await MicrophoneAccess.request()
      } catch {
        guard generation == self.generation else { return }
        microphone = nil
        island.showStatus(RecordingEngineText.message(error), kind: .failed)
      }
    }
    guard generation == self.generation else { return }
    let region = request.rect.offsetBy(dx: request.displayFrame.minX, dy: request.displayFrame.minY)
    marks.show(around: region)
    keys.hold(countingDown: true)
    let counted = await countdown.run(from: settings.countdown.seconds, centeredIn: region)
    guard counted, generation == self.generation else { return }
    // Started from here on: a cancel must not cancel the recorder's start with this task.
    countdownTask = nil
    keys.hold(countingDown: false)
    await start(request, microphone: microphone, generation: generation)
  }

  private func start(
    _ request: CaptureRecordRequest, microphone: RecordingMicrophone?, generation: Int
  ) async {
    stage = .starting
    let recorder = ScreenRecorder(config: config(for: request, microphone: microphone))
    recorder.onLive = { [weak self] in self?.update($0) }
    // The system's Stop, the display going away or a failing writer: keep what was recorded.
    recorder.onInterrupted = { [weak self] _ in
      if self?.stage == .recording { self?.stop() }
    }
    self.recorder = recorder
    do throws(RecordingError) {
      try await recorder.start()
    } catch {
      // A cancel meanwhile discarded it and cleaned up already.
      guard generation == self.generation else { return }
      self.recorder = nil
      endLive()
      claim?.release()
      claim = nil
      stage = .idle
      fail(error)
      return
    }
    guard generation == self.generation else { return }
    stage = .recording
    beginLive(microphone: microphone)
    if recorder.interruption != nil { stop() }
  }

  private func config(for request: CaptureRecordRequest, microphone: RecordingMicrophone?)
    -> RecordingConfig
  {
    RecordingConfig(
      displayID: request.displayID, rect: request.rect, fps: settings.frameRate.framesPerSecond,
      maxOutputWidth: settings.quality.maxPixelWidth, microphoneID: microphone?.id,
      systemAudio: settings.systemAudio, showsPointer: settings.showPointer,
      showsClicks: settings.showClicks, showsKeys: settings.showKeys, appName: request.appName)
  }

  // MARK: Ending

  /// Stop: the take is kept and processed. Before the recording runs it is a cancel.
  func stop() {
    switch stage {
    case .countingDown, .starting:
      cancel()
    case .recording:
      guard let recorder else { return }
      stage = .processing
      endLive()
      island.showProcessing()
      self.recorder = nil
      let claim = claim
      self.claim = nil
      let generation = generation
      Task { await finish(recorder, claim: claim, generation: generation) }
    case .idle, .processing:
      return
    }
  }

  /// The claim goes once the capture has stopped, whether or not a take came of it.
  private func finish(_ recorder: ScreenRecorder, claim: ResourceClaim?, generation: Int) async {
    let take: RecordingTake
    do throws(RecordingError) {
      take = try await recorder.stop()
    } catch {
      claim?.release()
      guard generation == self.generation else { return }
      stage = .idle
      fail(error)
      return
    }
    claim?.release()
    guard generation == self.generation else { return RecordingKept.delete(take.folder) }
    await process(take, generation: generation)
  }

  /// Ends the recording without keeping anything: a cancelled countdown, a confirmed discard, a
  /// stop before the recorder ran, or a quit. The recorder deletes its take.
  func cancel() {
    guard [.countingDown, .starting, .recording].contains(stage) else { return }
    generation += 1
    let recorder = recorder
    let claim = claim
    self.recorder = nil
    self.claim = nil
    Task {
      await recorder?.discard()
      claim?.release()
    }
    endLive()
    stage = .idle
    island.release()
  }

  /// A committed quit drops the live recording, any result still being processed, and the
  /// last result's files. A declined quit never reaches this method.
  func cancelForQuit() {
    cancel()
    generation += 1
    stage = .idle
    dropLastRecording()
  }

  /// Takes down what shows while a recording runs: the countdown, the corner marks, the timer and
  /// the stop keys.
  func endLive() {
    countdownTask?.cancel()
    countdownTask = nil
    countdown.hide()
    keys.release()
    statusItem.hide()
    marks.hide()
    face = .capsule
    pausedForDiscard = false
    switchingMicrophone = false
  }

  /// A recording that could not start or finish: the engine's words on the island, and the
  /// system's Screen Recording prompt when that grant is missing.
  func fail(_ error: RecordingError) {
    island.showStatus(RecordingEngineText.message(error), kind: .failed)
    if case .screenRecordingDenied = error { screenAccess.prompt() }
  }

  // MARK: Events

  /// What the island and the timer's menu ask for.
  private func handle(_ event: IslandRecordingEvent) {
    switch event {
    case .micToggle: toggleMicrophone()
    case .pause: pause()
    case .resume: resume()
    case .discard: askDiscard()
    case .stop: stop()
    case .confirmDiscard: if face == .discard { cancel() }
    case .keepRecording: keepRecording()
    case .ask(let ask), .regenerate(let ask): send(ask)
    case .stopAnswer(let askID): stopAsk(askID)
    case .openAnswer(let askID): panelHost.send(.recordingAskOpen(.init(askId: askID)))
    case .save(let trim): perform(.save, on: trim)
    case .copy(let trim): perform(.copy, on: trim)
    case .attach(let trim): perform(.attach, on: trim)
    // A closed card stays offered in the status menu (``lastRecordingAction``).
    case .close: return
    }
  }

  static func text(_ key: RecordingOrchestrationStringKey) -> String {
    ShellStrings.shared.text(key)
  }

  static func text(_ key: RecordingOrchestrationStringKey, _ argument: String) -> String {
    let strings = ShellStrings.shared
    return String(
      format: strings.text(key), locale: Locale(identifier: strings.language.rawValue), argument)
  }
}
