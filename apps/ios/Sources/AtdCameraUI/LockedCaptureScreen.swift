import SwiftUI

/// The Lock Screen capture extension's screen: the viewfinder with the modes the app last
/// published (`CaptureIntent.appContext`), starting in the mode used last. It only takes the
/// photo: the shutter writes the photo and its record into the session's folder and asks the
/// system to open Atd, which authenticates the person and reads, runs and then discards it.
/// 从照片选 hands over the same way and the app opens the library.
///
/// It takes the folder and the hand-off as plain values, not the session, so tests and
/// previews can draw it.
public struct LockedCaptureScreen: View {
  let folder: URL
  let open: () async throws -> Void
  @State private var capture: CameraCapture
  @State private var context: CameraContext?
  @State private var modeID: String?
  @State private var chosen: [String: String] = [:]
  @State private var stage = Stage.live

  enum Stage: Equatable {
    case live, saving, failed
  }

  /// - Parameters:
  ///   - folder: the session's content directory.
  ///   - open: opens Atd (`LockedCameraCaptureSession.openApplication(for:)`).
  public init(
    folder: URL, open: @escaping () async throws -> Void, capture: CameraCapture = CameraCapture(),
    context: CameraContext? = nil
  ) {
    self.folder = folder
    self.open = open
    _capture = State(initialValue: capture)
    _context = State(initialValue: context)
    _modeID = State(initialValue: context.flatMap(Self.start))
  }

  private var modes: [CameraMode] { context?.modes ?? [] }
  private var mode: CameraMode? { modes.first { $0.id == modeID } }
  private var optionValue: String? {
    mode?.option.map { chosen[$0.key] ?? $0.value }
  }

  public var body: some View {
    CameraViewfinder(
      capture: capture, modes: modes, modeID: $modeID, optionValue: optionValue,
      chooseOption: choose, isLive: stage == .live, close: nil, openSettings: nil,
      shoot: shoot, pickPhoto: { hand(photo: nil) }
    )
    .overlay {
      if stage != .live {
        Text(ViewfinderText.string(stage == .saving ? "locked.opening" : "locked.failed"))
          .font(.headline)
          .foregroundStyle(.white)
          .multilineTextAlignment(.center)
          .padding(24)
      }
    }
    .task {
      if context == nil {
        context = try? await CaptureIntent.appContext
        modeID = context.flatMap(Self.start)
      }
      await capture.start()
    }
  }

  private static func start(_ context: CameraContext) -> String? {
    CameraMode.start(in: context.modes, asked: nil, last: context.startModeID)?.id
  }

  private func choose(_ value: String) {
    if let key = mode?.option?.key { chosen[key] = value }
  }

  private func shoot() {
    guard stage == .live else { return }
    stage = .saving
    Task {
      do {
        hand(photo: try await capture.shoot())
      } catch {
        await failed()
      }
    }
  }

  /// Leaves the photo (or the request for the library) for the app and opens it.
  private func hand(photo: Data?) {
    stage = .saving
    let values = mode?.option.map { [$0.key: optionValue ?? $0.value] } ?? [:]
    let record = LockedCaptureRecord(modeID: modeID, values: values, capturedAt: .now)
    Task {
      do {
        try LockedCaptureFolder.write(record, photo: photo, into: folder)
        try await open()
        stage = .live
      } catch {
        // The photo stays in the folder; the app still finds it after the next unlock.
        await failed()
      }
    }
  }

  private func failed() async {
    stage = .failed
    try? await Task.sleep(for: .seconds(2))
    stage = .live
  }
}
