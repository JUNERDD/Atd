import AtdAI
import AtdModel
import Foundation
import Observation

/// One photo's way through the camera (prototype `camera.js`): live, then the photo frozen
/// while it is read on device and the command runs, then the answer marked on the photo, or why
/// there is none. Retaking cancels the run and goes back to live.
///
/// Nothing leaves the phone before a photo is taken or picked; the photo and its numbered text
/// go with the one request the run makes.
@Observable
final class CameraFlow {
  enum Phase: Equatable {
    case live
    /// The shutter fired; the photo is on its way.
    case capturing
    /// The photo is frozen and being read, or the command is running.
    case reading
    case answered
    case failed
  }

  private(set) var phase = Phase.live
  private(set) var shot: CameraShot?
  /// The answer so far; 翻译 fills it while it streams.
  private(set) var answer: CameraAnswer?
  private(set) var failure: CameraFailure?
  /// The command the photo runs, as it was when the run started.
  private(set) var command: Command?
  /// The photo as the request sent it, for 问 Atd.
  private(set) var modelImage: ModelImage?
  /// Where the photo came from when the Lock Screen camera took it.
  private(set) var lockedFolder: URL?
  @ObservationIgnored private var photo: Data?
  @ObservationIgnored private var generator: (any TextGenerating)?
  @ObservationIgnored private var task: Task<Void, Never>?

  /// The result sheet shows from the first streamed item until the person retakes.
  var showsResult: Bool {
    switch phase {
    case .answered, .failed: true
    case .reading: answer != nil
    case .live, .capturing: false
    }
  }

  /// The shutter fired; the stage takes over from the viewfinder.
  func capturing() {
    guard phase == .live else { return }
    phase = .capturing
  }

  /// Reads `photo` and runs `command` on it.
  func run(
    _ photo: Data, command: Command, generator: any TextGenerating, lockedFolder: URL? = nil
  ) {
    task?.cancel()
    self.photo = photo
    self.command = command
    self.generator = generator
    self.lockedFolder = lockedFolder
    shot = nil
    modelImage = nil
    start()
  }

  /// Runs the same photo again, after a failure or once a model was added.
  func retry(command: Command? = nil, generator: (any TextGenerating)? = nil) {
    guard photo != nil else { return }
    if let command { self.command = command }
    if let generator { self.generator = generator }
    start()
  }

  /// Back to live: cancels the run and forgets the photo.
  func retake() {
    task?.cancel()
    task = nil
    phase = .live
    shot = nil
    answer = nil
    failure = nil
    command = nil
    modelImage = nil
    photo = nil
    lockedFolder = nil
  }

  private func start() {
    guard let photo, let command, let generator else { return }
    phase = .reading
    answer = nil
    failure = nil
    task = Task {
      do {
        if shot == nil {
          guard let read = await CameraReader.read(photo) else {
            throw ModelFailure.unreadable(detail: nil)
          }
          try Task.checkCancellation()
          shot = read
        }
        if modelImage == nil { modelImage = await ImageEncoding.modelImage(from: photo) }
        guard let shot else { return }
        let answer = try await CameraRun.run(
          command, shot: shot, image: modelImage, generator: generator
        ) { [weak self] partial in
          self?.answer = partial
        }
        try Task.checkCancellation()
        self.answer = answer
        phase = .answered
      } catch is CancellationError {
        // Retaken: `retake()` has already gone back to live.
      } catch {
        guard !Task.isCancelled else { return }
        failure = CameraFailure(error)
        phase = .failed
      }
    }
  }
}
