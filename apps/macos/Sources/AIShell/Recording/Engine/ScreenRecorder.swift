import AICore
import AppKit
@_weakLinked import ScreenCaptureKit

/// One screen recording (decision R5): a ScreenCaptureKit stream of the configured region,
/// written to one movie with pauses cut out, plus the input log and, with Show Keys, the key
/// badges drawn into it. It records one take: ``start()`` once, then ``stop()`` for the take or
/// ``discard()``.
///
/// It owns no claim, countdown or corner marks; its owner shows those around it (see the
/// handoff's claim procedure). The recorder's owner is told the live state at most every
/// 200 ms (``onLive``) and a stop it did not ask for (``onInterrupted``): the take then stands
/// still at that moment, and the owner calls ``stop()`` to keep what was recorded until then, or
/// ``discard()``. All of it runs on the main actor; samples are written on the writer's queue.
final class ScreenRecorder {
  enum Phase: Equatable {
    case idle, starting, recording, stopping, ended
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
  private(set) var microphoneID: String?
  /// Why the capture stopped by itself, once it did. The take then holds only what came before
  /// that moment (no frame, sound or input after it, the clock standing still), pausing and the
  /// microphone no longer apply, and ``stop()`` keeps it.
  private(set) var interruption: RecordingInterruption?
  private let clock: RecordingWriterClock
  private var session: RecordingSession?
  private var inputLog: RecordingInputLog?
  private var keyBadges: RecordingKeyBadges?
  private var ticker: Task<Void, Never>?
  private var displays: NSObjectProtocol?
  /// An interruption heard while starting, with its host time: told once the take records.
  private var earlyInterruption: (reason: RecordingInterruption, time: Double)?
  /// The microphone the latest ``setMicrophone(_:)`` asked for.
  private var microphoneTarget: String?
  /// The calls waiting for the microphone switch under way; nil while none runs.
  private var microphoneWaiters: [CheckedContinuation<RecordingError?, Never>]?

  init(config: RecordingConfig) {
    self.config = config
    microphoneID = config.microphoneID
    microphoneTarget = config.microphoneID
    clock = RecordingWriterClock(microphoneOn: config.microphoneID != nil)
  }

  var isPaused: Bool { clock.current.timeline.isPaused }

  /// Starts recording. Asks for the microphone first when the configuration records one.
  /// Throws ``RecordingError/microphoneDenied``, ``RecordingError/screenRecordingDenied``,
  /// ``RecordingError/displayUnavailable`` or ``RecordingError/captureFailed(_:)``; the recorder
  /// has then cleaned up and ended.
  func start() async throws(RecordingError) {
    guard phase == .idle else { throw .notRecording }
    phase = .starting
    do throws(RecordingError) {
      if microphoneID != nil { try await MicrophoneAccess.request() }
      guard phase == .starting else { throw RecordingError.notRecording }
      let session = try await RecordingSession.open(
        config: config, microphoneID: microphoneID, clock: clock, prepare: prepareBadges,
        onInterruption: { [weak self] in self?.interrupt($0, at: $1) })
      guard phase == .starting else {
        await session.cancel()
        throw RecordingError.notRecording
      }
      self.session = session
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

  /// Turns the microphone on with `deviceID` (`AVCaptureDevice.uniqueID`, the remembered one) or
  /// off with nil, while recording. Turning it on asks for the grant at first need; turning it
  /// off stops the capture of the device, not only its recording. Switches run one at a time
  /// and the latest call wins: one made while a switch runs waits for it, and every waiting
  /// call hears how it ended. A refused grant leaves the microphone as it was; a switch the
  /// stream refuses leaves it off.
  func setMicrophone(_ deviceID: String?) async throws(RecordingError) {
    guard phase == .recording, interruption == nil, clock.current.timeline.stop == nil,
      session != nil
    else { throw .notRecording }
    microphoneTarget = deviceID
    if microphoneWaiters != nil {
      let failure = await withCheckedContinuation { microphoneWaiters?.append($0) }
      if let failure { throw failure }
      return
    }
    microphoneWaiters = []
    var failure: RecordingError?
    do throws(RecordingError) {
      try await switchMicrophone()
    } catch {
      failure = error
    }
    let waiters = microphoneWaiters ?? []
    microphoneWaiters = nil
    for waiter in waiters { waiter.resume(returning: failure) }
    if let failure { throw failure }
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

  /// Drops the recording and its files while it starts or records. Nothing once ``stop()`` began:
  /// its take, or its failure, settles the files (the caller deletes a take's folder).
  func discard() async {
    guard phase == .idle || phase == .starting || phase == .recording else { return }
    phase = .ended
    await tearDown()
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

  private func tick() {
    onLive?(clock.live(at: RecordingSamples.hostNow))
  }

  /// Applies ``microphoneTarget`` until the microphone matches it, reading it again after every
  /// wait. A failure leaves the target at the microphone as the failure left it.
  private func switchMicrophone() async throws(RecordingError) {
    while microphoneTarget != microphoneID {
      let target = microphoneTarget
      do throws(RecordingError) {
        if target != nil { try await MicrophoneAccess.request() }
        guard phase == .recording, interruption == nil, clock.current.timeline.stop == nil,
          let session
        else {
          throw RecordingError.notRecording
        }
        guard target == microphoneTarget else { continue }
        // Off first, so nothing the old device still sends is written; on again after the
        // switch, so another device starts a file of its own.
        clock.setMicrophone(on: false)
        microphoneID = nil
        try await session.update(microphoneID: target)
        guard phase == .recording, interruption == nil, clock.current.timeline.stop == nil else {
          throw RecordingError.notRecording
        }
        microphoneID = target
        // Not when it was turned off again meanwhile: the file would hold nothing wanted.
        if target != nil, target == microphoneTarget { clock.setMicrophone(on: true) }
        tick()
      } catch {
        if phase == .recording, interruption == nil, clock.current.timeline.stop == nil,
          target != microphoneTarget
        {
          continue
        }
        microphoneTarget = microphoneID
        throw error
      }
    }
  }

  /// The capture stopped by itself at host `time`. The take stops there (nothing captured from
  /// then on counts, the clock stands still, the input log stops listening) and the owner hears
  /// it, once. Heard while starting, it waits until the take records.
  private func interrupt(_ reason: RecordingInterruption, at time: Double) {
    if phase == .starting {
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
