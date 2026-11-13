import AICore
import Foundation

/// The recording while it runs (architecture R7): the island's capsule and the menu bar timer
/// both follow the recorder's live state, at most every 200 ms; the capsule's values change in
/// place, so only a pause, a resume or the microphone swaps its glyphs. Pause, discard and stop
/// arrive from either surface; the microphone toggle from the capsule.
extension ScreenRecordingController {
  /// The recorder runs: the capsule and the timer appear at 0:00.
  func beginLive(microphone: RecordingMicrophone?) {
    self.microphone = microphone
    refreshSwitchName(among: RecordingMicrophones.available())
    face = .capsule
    update(
      RecordingLiveState(
        elapsed: 0, isPaused: false, microphoneLevel: 0, isMicrophoneOn: microphone != nil))
  }

  /// The recorder's live state: the timer always, the capsule unless the discard confirmation
  /// or a note has the island. A note gives the island back a little before it would leave by
  /// itself, so the page's progress never flashes in between.
  func update(_ state: RecordingLiveState) {
    guard stage == .recording else { return }
    if state.isPaused != live.isPaused { marks.setPaused(state.isPaused) }
    live = state
    statusItem.show(elapsed: state.elapsed, paused: state.isPaused)
    if case .note(let until) = face, ContinuousClock.now >= until { face = .capsule }
    guard face == .capsule else { return }
    island.showCapsule(
      RecordingCapsule(
        elapsed: state.elapsed, paused: state.isPaused,
        microphone: state.isMicrophoneOn ? microphone?.name : nil, lastMicrophone: switchName,
        level: state.microphoneLevel))
  }

  func pause() {
    guard stage == .recording else { return }
    recorder?.pause()
  }

  /// Resume, from the capsule or the timer's menu; over the discard confirmation it keeps the
  /// recording, running.
  func resume() {
    guard stage == .recording, let recorder else { return }
    if face == .discard {
      face = .capsule
      pausedForDiscard = false
      update(live)
    }
    recorder.resume()
  }

  /// The capsule's or the menu's discard: the recording pauses while the island asks. Before the
  /// recorder runs there is nothing to lose, so it is cancelled at once.
  func askDiscard() {
    switch stage {
    case .countingDown, .starting:
      cancel()
    case .recording:
      guard let recorder, face != .discard else { return }
      face = .discard
      pausedForDiscard = !recorder.isPaused
      recorder.pause()
      island.showDiscard(elapsed: live.elapsed)
    case .idle, .processing:
      return
    }
  }

  /// Keep Recording: back to the capsule, running again if the confirmation paused it.
  func keepRecording() {
    guard stage == .recording, face == .discard, let recorder else { return }
    face = .capsule
    let resumes = pausedForDiscard
    pausedForDiscard = false
    update(live)
    if resumes { recorder.resume() }
  }

  /// The capsule's microphone: off while one records; else on with the one used last (then the
  /// system's default input, then any). The choice is remembered as the Sound menu's.
  func toggleMicrophone() {
    guard stage == .recording, let recorder, !switchingMicrophone else { return }
    let devices = RecordingMicrophones.available()
    let next: RecordingMicrophone?
    if microphone == nil {
      next = settings.switchMicrophone(among: devices, defaultID: RecordingMicrophones.defaultID())
      guard next != nil else { return note(Self.text(.noMicrophone)) }
    } else {
      next = nil
    }
    switchingMicrophone = true
    let generation = generation
    Task {
      do throws(RecordingError) {
        try await recorder.setMicrophone(next?.id)
      } catch {
        guard generation == self.generation else { return }
        switchingMicrophone = false
        // A failed switch leaves the microphone off (or as it was, when the grant was refused).
        if recorder.microphoneID == nil { microphone = nil }
        update(live)
        return note(RecordingEngineText.message(error))
      }
      guard generation == self.generation else { return }
      switchingMicrophone = false
      microphone = next
      settings.chooseMicrophone(next?.id)
      var remembered = RecordingSettingsMemory.load(from: defaults)
      remembered.chooseMicrophone(next?.id)
      RecordingSettingsMemory.save(remembered, to: defaults)
      refreshSwitchName(among: devices)
      update(live)
    }
  }

  /// A short note on the island while recording, in place of the capsule.
  func note(_ message: String) {
    guard stage == .recording, face != .discard else { return }
    face = .note(until: .now + IslandRecording.statusDuration - .milliseconds(250))
    island.showStatus(message, kind: .failed)
  }

  private func refreshSwitchName(among devices: [RecordingMicrophone]) {
    switchName =
      settings.switchMicrophone(among: devices, defaultID: RecordingMicrophones.defaultID())?.name
  }
}
