import AtdAI
import AtdCameraUI
import AtdModel
import PhotosUI
import SwiftUI

/// How the camera opens: in a command's mode when the route names one (running a photo handed to
/// `CameraInbox`, if any), or with the photos the Lock Screen capture extension took.
enum CameraEntry: Hashable, Identifiable {
  case live(commandID: String?)
  case lockedCapture

  var id: Self { self }

  /// The entry a camera route names; nil for any other route.
  init?(_ route: AtdRoute) {
    switch route {
    case .camera(let commandID): self = .live(commandID: commandID)
    case .lockedCapture: self = .lockedCapture
    default: return nil
    }
  }
}

/// 拍了就办, full screen over the tabs (prototype `camera.js`): Atd's viewfinder, then the
/// frozen photo with the answer marked on it and the result sheet under it. The root presents
/// it for a camera route; while it shows, later camera routes come here (taken from
/// `RouteCenter`): a mode switches the viewfinder back to live, a Lock Screen capture is run.
struct CameraScreen: View {
  @State private var entry: CameraEntry
  @Environment(AppStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var capture = CameraCapture()
  @State private var flow = CameraFlow()
  @State private var modeID: String?
  @State private var picking = false
  @State private var picked: PhotosPickerItem?
  @State private var flashing = false
  @State private var shots = 0
  private let routes = RouteCenter.shared
  private let inbox = CameraInbox.shared

  init(entry: CameraEntry) {
    _entry = State(initialValue: entry)
  }

  private var modes: [CameraMode] { CameraMode.modes(in: store.library) }
  private var command: Command? { modeID.flatMap { store.library.command($0) } }

  var body: some View {
    ZStack {
      CameraViewfinder(
        capture: capture, modes: modes, modeID: $modeID,
        optionValue: command?.options.first?.value, chooseOption: chooseOption,
        isLive: flow.phase == .live, close: { dismiss() },
        openSettings: { CameraActions.settingsURL.map { openURL($0) } }, shoot: shoot,
        pickPhoto: { picking = true })
      if let shot = flow.shot {
        CameraStage(
          shot: shot, answer: flow.answer, reading: flow.phase == .reading,
          bottomInset: flow.showsResult ? CameraResultSheet.height : 0)
      }
      if flashing {
        Color.white.ignoresSafeArea().allowsHitTesting(false)
      }
    }
    .statusBarHidden(flow.phase == .live)
    .sheet(isPresented: resultShown) {
      CameraResultSheet(flow: flow, retake: retake, retry: retry)
        .environment(store)
    }
    .photosPicker(isPresented: $picking, selection: $picked, matching: .images)
    .onChange(of: picked) { _, item in
      guard let item else { return }
      picked = nil
      Task {
        if let data = try? await item.loadTransferable(type: Data.self) { run(data) }
      }
    }
    .sensoryFeedback(.impact, trigger: shots)
    .sensoryFeedback(.success, trigger: flow.phase) { _, phase in phase == .answered }
    .task { open(entry) }
    .onChange(of: routes.pending) {
      if let entry = routes.take(CameraEntry.init) { open(entry) }
    }
    .onChange(of: modeID) { _, id in
      guard let id else { return }
      CameraMemory.lastModeID = id
      CameraLaunch.publish(store.library)
    }
    .onChange(of: flow.shot != nil) { _, frozen in
      if frozen { inbox.endDelaying() }
    }
    .onDisappear {
      finishLocked()
      Task { await capture.stop() }
    }
  }

  private var resultShown: Binding<Bool> {
    Binding(get: { flow.showsResult }, set: { if !$0 { retake() } })
  }

  /// Opens `entry`: a mode goes back to live in it; a Lock Screen capture runs.
  private func open(_ entry: CameraEntry) {
    self.entry = entry
    switch entry {
    case .live(let commandID):
      if flow.phase != .live { retake() }
      modeID = CameraMode.start(in: modes, asked: commandID, last: CameraMemory.lastModeID)?.id
      if let photo = inbox.takeHanded() {
        run(photo)
        return
      }
      Task { await capture.start() }
    case .lockedCapture:
      guard let locked = inbox.next() else {
        open(.live(commandID: nil))
        return
      }
      importLocked(locked)
    }
  }

  /// Runs a Lock Screen capture in the mode and with the option the person chose there; both
  /// become the remembered ones.
  private func importLocked(_ locked: LockedCapture) {
    finishLocked()
    let record = locked.record
    if let id = record.modeID, var command = store.library.command(id) {
      for (key, value) in record.values where command.option(key) != nil {
        command.setValue(value, for: key)
      }
      store.save(command)
    }
    modeID = CameraMode.start(in: modes, asked: record.modeID, last: CameraMemory.lastModeID)?.id
    guard let photo = locked.photo else {
      inbox.finish(locked.folder)
      Task { await capture.start() }
      picking = true
      return
    }
    run(photo, lockedFolder: locked.folder)
  }

  private func chooseOption(_ value: String) {
    guard var command, let option = command.options.first else { return }
    command.setValue(value, for: option.key)
    store.save(command)
  }

  private func shoot() {
    guard flow.phase == .live, command != nil else { return }
    shots += 1
    flow.capturing()
    flashing = true
    Task {
      do {
        let photo = try await capture.shoot()
        withAnimation(.easeOut(duration: capture.flashOn ? 0.56 : 0.3)) { flashing = false }
        run(photo)
      } catch {
        flashing = false
        flow.retake()
      }
    }
  }

  /// Freezes `photo` and runs the current mode's command on it; the camera stops meanwhile.
  private func run(_ photo: Data, lockedFolder: URL? = nil) {
    guard let command else { return }
    flow.run(photo, command: command, generator: store.runner, lockedFolder: lockedFolder)
    Task { await capture.stop() }
  }

  private func retry() {
    flow.retry(command: command, generator: store.runner)
  }

  /// Back to live; a Lock Screen capture is discarded, and the next one, if any, shows.
  private func retake() {
    finishLocked()
    flow.retake()
    if inbox.next() != nil {
      open(.lockedCapture)
    } else {
      Task { await capture.start() }
    }
  }

  private func finishLocked() {
    if let folder = flow.lockedFolder { inbox.finish(folder) }
  }
}
