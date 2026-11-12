import AICore
import AppKit
@_weakLinked import ScreenCaptureKit

/// One screen recording (decision R5): a ScreenCaptureKit stream of the configured region,
/// written to one movie with pauses cut out, plus the input log and, with Show Keys, the key
/// badges drawn into it. It records one take: optionally ``prepare()`` ahead of time, ``start()``
/// once, then ``stop()`` for the take or ``discard()``.
///
/// It owns no claim, countdown or corner marks; its owner shows those around it (see the
/// handoff's claim procedure). The recorder's owner is told the live state at most every
/// 200 ms (``onLive``) and a stop it did not ask for (``onInterrupted``): the take then stands
/// still at that moment, and the owner calls ``stop()`` to keep what was recorded until then, or
/// ``discard()``. All of it runs on the main actor; samples are written on the writer's queue.
final class ScreenRecorder {
  enum Phase: Equatable {
    case idle, preparing, prepared, starting, recording, stopping, ended
  }

  /// The live state, every 200 ms while recording, at once after a pause, resume or
  /// microphone switch, and a last time, standing still, when the take is interrupted.
  var onLive: ((RecordingLiveState) -> Void)?
  /// The capture stopped by itself: the system's Stop, the display going away, or a failure.
  /// Told once, after the take stopped at that moment (``interruption``).
  var onInterrupted: ((RecordingInterruption) -> Void)?

  let config: RecordingConfig
  private(set) var phase: Phase = .idle
  /// The microphone recorded now; nil while it is off.
  var microphoneID: String?
  /// Why the capture stopped by itself, once it did. The take then holds only what came before
  /// that moment (no frame, sound or input after it, the clock standing still), pausing and the
  /// microphone no longer apply, and ``stop()`` keeps it.
  private(set) var interruption: RecordingInterruption?
  let clock: RecordingWriterClock
  var session: RecordingSession?
  private var preparation: Task<Result<RecordingSession, RecordingError>, Never>?
  private var prepareFailure: RecordingError?
  private var inputLog: RecordingInputLog?
  private var keyBadges: RecordingKeyBadges?
  private var ticker: Task<Void, Never>?
  private var displays: NSObjectProtocol?
  /// An interruption heard before recording begins, with its host time: told once the take records.
  private var earlyInterruption: (reason: RecordingInterruption, time: Double)?
  /// The microphone the latest ``setMicrophone(_:)`` asked for.
  var microphoneTarget: String?
  /// The calls waiting for the microphone switch under way; nil while none runs.
  var microphoneWaiters: [CheckedContinuation<RecordingError?, Never>]?

  init(config: RecordingConfig) {
    self.config = config
    microphoneID = config.microphoneID
    microphoneTarget = config.microphoneID
    clock = RecordingWriterClock(microphoneOn: config.microphoneID != nil)
  }

  var isPaused: Bool { clock.current.timeline.isPaused }

  /// Opens the take's stream and writer ahead of ``start()`` without capturing samples or input
  /// yet. ``discard()`` cleans up at any point.
  func prepare() async throws(RecordingError) {
    if let prepareFailure { throw prepareFailure }
    if phase == .prepared { return }
    guard phase == .idle || phase == .preparing else { throw .notRecording }
    if phase == .idle { phase = .preparing }
    _ = try await openSession()
    if phase == .preparing { phase = .prepared }
  }

  /// Starts recording, reusing a prepared session when ``prepare()`` opened one. Throws
  /// ``RecordingError/microphoneDenied``, ``RecordingError/screenRecordingDenied``,
  /// ``RecordingError/displayUnavailable`` or ``RecordingError/captureFailed(_:)``; the recorder
  /// has then cleaned up and ended.
  func start() async throws(RecordingError) {
    if let prepareFailure {
      self.prepareFailure = nil
      throw prepareFailure
    }
    guard [.idle, .preparing, .prepared].contains(phase) else { throw .notRecording }
    phase = .starting
    do throws(RecordingError) {
      let session = try await openSession()
      guard phase == .starting else {
        await session.cancel()
        throw RecordingError.notRecording
      }
      guard CGDisplayBounds(config.displayID).width > 0,
        NSScreen.screens.contains(where: { $0.displayID == config.displayID })
      else { throw RecordingError.displayUnavailable }
      let log = RecordingInputLog(region: session.region)
      log.onKey = { [weak self] press in
        guard let self, !self.isPaused else { return }
        self.keyBadges?.show(press)
      }
      inputLog = log
      log.start()
      try await session.startCapture()
      // Discarded while the stream started: the discard already deleted the take.
      guard phase == .starting else {
        await session.stopCapture()
        throw RecordingError.notRecording
      }
    } catch {
      phase = .ended
      await tearDown()
      throw error
    }
    phase = .recording
    watchDisplays()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        self.tick()
        try? await Task.sleep(for: .milliseconds(200))
      }
    }
    if let early = earlyInterruption {
      earlyInterruption = nil
      // After start() returns, so the owner hears it as it hears any other.
      Task { [weak self] in self?.interrupt(early.reason, at: early.time) }
    }
  }

  func pause() {
    guard phase == .recording, interruption == nil, !isPaused else { return }
    clock.pause(at: RecordingSamples.hostNow)
    keyBadges?.clear()
    tick()
  }

  func resume() {
    guard phase == .recording, interruption == nil, isPaused else { return }
    clock.resume(at: RecordingSamples.hostNow)
    tick()
  }

  /// Stops and finishes the take at this moment; after an interruption, keeping what was
  /// recorded until it. The take's folder then belongs to the caller. Throws
  /// ``RecordingError/writerFailed(_:)`` when no movie could be finished, after cleaning up; a
  /// movie that was written is always returned, its missing parts in ``RecordingTake/issues``.
  func stop() async throws(RecordingError) -> RecordingTake {
    guard phase == .recording, let session else { throw .notRecording }
    phase = .stopping
    let stop = RecordingSamples.hostNow
    // Nothing captured from now on counts, however long the input log and the stream take to
    // stop.
    clock.stop(at: stop)
    endLive()
    let events = await inputLog?.stop() ?? []
    inputLog = nil
    do throws(RecordingError) {
      let take = try await session.finish(at: stop, events: events, appName: Self.appName(config))
      phase = .ended
      self.session = nil
      return take
    } catch {
      phase = .ended
      await tearDown()
      throw error
    }
  }

  /// Drops the recording and its files before or while it records. Nothing once ``stop()`` began:
  /// its take, or its failure, settles the files (the caller deletes a take's folder).
  func discard() async {
    guard [.idle, .preparing, .prepared, .starting, .recording].contains(phase) else { return }
    phase = .ended
    await tearDown()
  }

  private func openSession() async throws(RecordingError) -> RecordingSession {
    if let prepareFailure { throw prepareFailure }
    if let session { return session }
    let task =
      preparation
      ?? Task<Result<RecordingSession, RecordingError>, Never> { [weak self] in
        guard let self else { return .failure(.notRecording) }
        do throws(RecordingError) {
          if self.microphoneID != nil { try await MicrophoneAccess.request() }
          guard self.phase == .preparing || self.phase == .starting else {
            throw RecordingError.notRecording
          }
          let session = try await RecordingSession.open(
            config: self.config, microphoneID: self.microphoneID, clock: self.clock,
            prepare: { [weak self] in self?.prepareBadges(region: $0) },
            onInterruption: { [weak self] in self?.interrupt($0, at: $1) })
          guard self.phase == .preparing || self.phase == .starting else {
            await session.cancel()
            throw RecordingError.notRecording
          }
          self.session = session
          return .success(session)
        } catch {
          return .failure(error)
        }
      }
    preparation = task
    let result = await task.value
    preparation = nil
    switch result {
    case .success(let session):
      guard [.preparing, .prepared, .starting, .recording].contains(phase) else {
        throw .notRecording
      }
      return session
    case .failure(let error):
      if phase == .preparing {
        prepareFailure = error
        phase = .ended
        await tearDown()
      }
      throw error
    }
  }

  /// Shows the key badges' window before the stream reads what is on screen, so its filter
  /// can keep it; nil without Show Keys.
  private func prepareBadges(region: CGRect) -> Int? {
    guard config.showsKeys else { return nil }
    let badges = RecordingKeyBadges(region: region)
    badges.prepare()
    keyBadges = badges
    return badges.windowNumber
  }

  func tick() {
    onLive?(clock.live(at: RecordingSamples.hostNow))
  }

  /// The capture stopped by itself at host `time`. The take stops there (nothing captured from
  /// then on counts, the clock stands still, the input log stops listening) and the owner hears
  /// it, once. Heard before recording begins, it waits until the take records.
  private func interrupt(_ reason: RecordingInterruption, at time: Double) {
    if [.preparing, .prepared, .starting].contains(phase) {
      if earlyInterruption == nil { earlyInterruption = (reason, time) }
      clock.stop(at: time)
      inputLog?.stopListening()
      keyBadges?.clear()
      return
    }
    guard phase == .recording, interruption == nil else { return }
    interruption = reason
    clock.stop(at: time)
    endLive()
    inputLog?.stopListening()
    let session = session
    Task { await session?.stopCapture() }
    tick()
    onInterrupted?(reason)
  }

  /// The recorded display going away interrupts the take.
  private func watchDisplays() {
    displays = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        if !NSScreen.screens.contains(where: { $0.displayID == self.config.displayID }) {
          self.interrupt(.displayRemoved, at: RecordingSamples.hostNow)
        }
      }
    }
  }

  private func endLive() {
    ticker?.cancel()
    ticker = nil
    if let displays { NotificationCenter.default.removeObserver(displays) }
    displays = nil
    keyBadges?.hide()
    keyBadges = nil
  }

  /// Ends everything and deletes the take's folder.
  private func tearDown() async {
    let pending = preparation
    preparation = nil
    pending?.cancel()
    _ = await pending?.value
    clock.stop(at: RecordingSamples.hostNow)
    endLive()
    _ = await inputLog?.stop()
    inputLog = nil
    await session?.cancel()
    session = nil
  }

  /// The app the take is about: the selection's, else the app in front now.
  private static func appName(_ config: RecordingConfig) -> String? {
    if let name = config.appName { return name }
    let front = NSWorkspace.shared.frontmostApplication
    guard front?.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return nil }
    return front?.localizedName
  }
}
