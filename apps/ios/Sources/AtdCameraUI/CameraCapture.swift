import AVFoundation
import Observation
import Synchronization

/// Whether the camera shows a live picture, and why not.
public nonisolated enum CameraStatus: Sendable, Equatable {
  case starting
  case running
  /// The person has not allowed the camera, or a restriction forbids it.
  case denied
  /// There is no camera (the simulator), or it could not be set up.
  case unavailable
  /// Another app is using it, or Atd is not full screen.
  case interrupted
}

/// The back camera, for the app's camera and the Lock Screen capture extension: asks for
/// access, runs the session while the viewfinder shows and takes one photo at a time. The
/// session itself lives in `CaptureService`, off the main actor.
@Observable
public final class CameraCapture {
  public private(set) var status: CameraStatus
  public private(set) var hasFlash = false
  public var flashOn = false
  @ObservationIgnored let service = CaptureService()
  @ObservationIgnored private var observers: [any NSObjectProtocol] = []
  @ObservationIgnored private let fixed: Bool

  public init() {
    status = .starting
    fixed = false
  }

  /// A camera that stays in `status` and never starts, for previews and snapshots.
  public init(status: CameraStatus) {
    self.status = status
    fixed = true
  }

  /// Asks for access the first time, sets the session up and starts it. Without a camera to
  /// use (the simulator) it says so without asking.
  public func start() async {
    guard !fixed, status != .running else { return }
    guard await service.hasCamera() else {
      status = .unavailable
      return
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      break
    case .notDetermined:
      guard await AVCaptureDevice.requestAccess(for: .video) else {
        status = .denied
        return
      }
    default:
      status = .denied
      return
    }
    guard let flash = await service.configure() else {
      status = .unavailable
      return
    }
    hasFlash = flash
    watchInterruptions()
    await service.start()
    status = .running
  }

  /// Stops the session, which turns the camera indicator off.
  public func stop() async {
    guard !fixed else { return }
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    await service.stop()
    if status == .running || status == .interrupted { status = .starting }
  }

  /// Takes a photo with the flash when it is on; HEIC or JPEG data with its orientation.
  public func shoot() async throws -> Data {
    try await service.capture(flash: flashOn && hasFlash)
  }

  private func watchInterruptions() {
    guard observers.isEmpty else { return }
    let changes: [(Notification.Name, CameraStatus)] = [
      (AVCaptureSession.wasInterruptedNotification, .interrupted),
      (AVCaptureSession.interruptionEndedNotification, .running),
      (AVCaptureSession.runtimeErrorNotification, .unavailable),
    ]
    observers = changes.map { name, status in
      NotificationCenter.default.addObserver(
        forName: name, object: service.box.session, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.status = status }
      }
    }
  }
}

/// Why a photo could not be taken.
public nonisolated enum CameraCaptureError: Error, Sendable {
  case notRunning
  case noPhoto
}

/// Owns the capture session. Starting and stopping it block, so every call runs on the actor's
/// own serial queue rather than the main thread (Apple's AVCam pattern).
actor CaptureService {
  private let queue = DispatchSerialQueue(label: "com.junerdd.atd.camera")
  nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

  /// The session, which the preview layer also shows from the main actor.
  nonisolated let box = CaptureSessionBox()
  private var session: AVCaptureSession { box.session }
  private let output = AVCapturePhotoOutput()
  private var rotation: AVCaptureDevice.RotationCoordinator?
  private var configured = false
  /// The photo output does not keep its delegate; this does until the next photo.
  private var inFlight: PhotoDelegate?

  /// Whether there is a back camera; finding one needs no access.
  func hasCamera() -> Bool {
    Self.backCamera() != nil
  }

  /// Sets the session up once: the best back camera and a photo output. Whether the camera has
  /// a flash, or nil when there is no camera to use.
  func configure() -> Bool? {
    if !configured {
      guard let device = Self.backCamera(), let input = try? AVCaptureDeviceInput(device: device)
      else { return nil }
      session.beginConfiguration()
      session.sessionPreset = .photo
      let added = session.canAddInput(input) && session.canAddOutput(output)
      if added {
        session.addInput(input)
        session.addOutput(output)
        output.maxPhotoQualityPrioritization = .balanced
      }
      session.commitConfiguration()
      guard added else { return nil }
      rotation = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
      configured = true
    }
    return output.supportedFlashModes.contains(.on)
  }

  func start() {
    if configured, !session.isRunning { session.startRunning() }
  }

  /// The best back camera: triple, dual wide, dual, then wide.
  private nonisolated static func backCamera() -> AVCaptureDevice? {
    let types: [AVCaptureDevice.DeviceType] = [
      .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera,
    ]
    return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back)
      .devices.first
  }

  func stop() {
    if session.isRunning { session.stopRunning() }
  }

  func capture(flash: Bool) async throws -> Data {
    guard configured, session.isRunning else { throw CameraCaptureError.notRunning }
    let settings = AVCapturePhotoSettings()
    settings.flashMode = flash && output.supportedFlashModes.contains(.on) ? .on : .off
    settings.photoQualityPrioritization = .balanced
    // Level with the horizon however the phone is held; the interface itself stays portrait.
    if let connection = output.connection(with: .video),
      let angle = rotation?.videoRotationAngleForHorizonLevelCapture,
      connection.isVideoRotationAngleSupported(angle)
    {
      connection.videoRotationAngle = angle
    }
    return try await withCheckedThrowingContinuation { continuation in
      let delegate = PhotoDelegate(continuation)
      inFlight = delegate
      output.capturePhoto(with: settings, delegate: delegate)
    }
  }
}

/// The capture session, shared by `CaptureService`, which configures, starts and stops it on its
/// queue, and the preview layer, which only shows it.
nonisolated final class CaptureSessionBox: @unchecked Sendable {
  let session = AVCaptureSession()
}

/// Hands one photo's data to the waiting capture. AVFoundation calls it on its own queue.
nonisolated final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate, Sendable {
  private let continuation: Mutex<CheckedContinuation<Data, any Error>?>

  init(_ continuation: CheckedContinuation<Data, any Error>) {
    self.continuation = Mutex(continuation)
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto,
    error: (any Error)?
  ) {
    if let data = photo.fileDataRepresentation() {
      resume(with: .success(data))
    } else {
      resume(with: .failure(error ?? CameraCaptureError.noPhoto))
    }
  }

  func photoOutput(
    _ output: AVCapturePhotoOutput,
    didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: (any Error)?
  ) {
    // Ends a capture that failed before any photo was processed.
    resume(with: .failure(error ?? CameraCaptureError.noPhoto))
  }

  private func resume(with result: Result<Data, any Error>) {
    let waiting = continuation.withLock { continuation in
      defer { continuation = nil }
      return continuation
    }
    waiting?.resume(with: result)
  }
}
