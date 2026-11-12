import AICore

extension ScreenRecorder {
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
}
