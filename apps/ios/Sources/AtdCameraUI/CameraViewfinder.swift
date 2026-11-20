import AVKit
import AtdInk
import SwiftUI

/// Atd's viewfinder (prototype `camera.js`), shown full screen by the app's camera and by the
/// Lock Screen capture extension: the live picture with guide corners, ✕ (app only), the mode's
/// option chip and the flash at the top, the modes, 从照片选 and the shutter at the bottom. The
/// volume buttons and the Camera Control take the photo too. Swiping the picture changes mode.
///
/// It draws no result: when `isLive` is false (a photo is being read) its controls hide and
/// the owner shows the frozen photo over it.
public struct CameraViewfinder: View {
  let capture: CameraCapture
  let modes: [CameraMode]
  @Binding var modeID: String?
  /// The current mode's option value for this shot.
  let optionValue: String?
  let chooseOption: (String) -> Void
  let isLive: Bool
  /// ✕; nil in the capture extension, which the person leaves by swiping up.
  let close: (() -> Void)?
  /// 去设置 when the camera is not allowed; nil where Settings cannot be opened.
  let openSettings: (() -> Void)?
  let shoot: () -> Void
  let pickPhoto: () -> Void

  public init(
    capture: CameraCapture, modes: [CameraMode], modeID: Binding<String?>, optionValue: String?,
    chooseOption: @escaping (String) -> Void, isLive: Bool, close: (() -> Void)?,
    openSettings: (() -> Void)?, shoot: @escaping () -> Void,
    pickPhoto: @escaping () -> Void
  ) {
    self.capture = capture
    self.modes = modes
    _modeID = modeID
    self.optionValue = optionValue
    self.chooseOption = chooseOption
    self.isLive = isLive
    self.close = close
    self.openSettings = openSettings
    self.shoot = shoot
    self.pickPhoto = pickPhoto
  }

  private var mode: CameraMode? { modes.first { $0.id == modeID } }
  private var canShoot: Bool { isLive && capture.status == .running && mode != nil }

  public var body: some View {
    VStack(spacing: 0) {
      topBar
      Spacer(minLength: 0)
      bottomBar
    }
    .opacity(isLive ? 1 : 0)
    .allowsHitTesting(isLive)
    .background {
      ZStack {
        Color.black
        feed
        shades
      }
      .ignoresSafeArea()
    }
    .environment(\.colorScheme, .dark)
    .gesture(swipe, including: isLive ? .all : .subviews)
    .onCameraCaptureEvent(isEnabled: canShoot) { event in
      if event.phase == .ended { shoot() }
    }
  }

  @ViewBuilder private var feed: some View {
    switch capture.status {
    case .starting, .running:
      CameraPreview(session: capture.service.box.session)
      if capture.status == .running {
        GuideCorners()
          .stroke(.white.opacity(0.9), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
          .allowsHitTesting(false)
      }
    case .denied:
      notice(
        ViewfinderText.string("viewfinder.denied"),
        detail: ViewfinderText.string("viewfinder.denied.detail"), settings: openSettings)
    case .unavailable, .interrupted:
      notice(
        ViewfinderText.string("viewfinder.unavailable"),
        detail: ViewfinderText.string("viewfinder.unavailable.detail"), settings: nil)
    }
  }

  private func notice(_ title: String, detail: String, settings: (() -> Void)?) -> some View {
    VStack(spacing: 10) {
      Image(systemName: "camera").font(.system(size: 40, weight: .light))
        .accessibilityHidden(true)
      Text(title).font(.headline)
      Text(detail).font(.subheadline).foregroundStyle(.white.opacity(0.7))
      if let settings {
        Button(ViewfinderText.string("viewfinder.settings"), action: settings)
          .buttonStyle(InkButtonStyle())
          .padding(.top, 6)
      }
    }
    .multilineTextAlignment(.center)
    .foregroundStyle(.white)
    .padding(32)
  }

  private var shades: some View {
    VStack {
      LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .top, endPoint: .bottom)
        .frame(height: 150)
      Spacer()
      LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
        .frame(height: 220)
    }
    .allowsHitTesting(false)
  }

  private var topBar: some View {
    HStack {
      if let close {
        Button(action: close) { Image(systemName: "xmark") }
          .buttonStyle(RimButtonStyle())
          .accessibilityLabel(ViewfinderText.string("viewfinder.close"))
      } else {
        Color.clear.frame(width: 44, height: 44)
      }
      Spacer(minLength: 8)
      if let option = mode?.option, let optionValue {
        OptionChip(option: option, value: optionValue, choose: chooseOption)
      }
      Spacer(minLength: 8)
      if capture.hasFlash {
        Button {
          capture.flashOn.toggle()
        } label: {
          Image(systemName: capture.flashOn ? "bolt.fill" : "bolt.slash")
        }
        .buttonStyle(RimButtonStyle(seed: 5))
        .accessibilityLabel(ViewfinderText.string("viewfinder.flash"))
        .accessibilityValue(
          ViewfinderText.string(capture.flashOn ? "viewfinder.flash.on" : "viewfinder.flash.off"))
      } else {
        Color.clear.frame(width: 44, height: 44)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
  }

  private var bottomBar: some View {
    VStack(spacing: 14) {
      if modes.isEmpty {
        Text(ViewfinderText.string("viewfinder.noModes"))
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.8))
          .frame(minHeight: 44)
      } else {
        CameraModeStrip(modes: modes, selection: $modeID)
      }
      HStack {
        Button(action: pickPhoto) { Image(systemName: "photo.on.rectangle") }
          .buttonStyle(RimButtonStyle(seed: 7))
          .accessibilityLabel(ViewfinderText.string("viewfinder.library"))
          .disabled(mode == nil)
          .frame(maxWidth: .infinity)
        ShutterButton(isEnabled: canShoot, action: shoot)
        Color.clear.frame(width: 44, height: 44).frame(maxWidth: .infinity)
      }
    }
    .padding(.bottom, 12)
  }

  /// A horizontal swipe longer than 50 points moves to the next or previous mode.
  private var swipe: some Gesture {
    DragGesture(minimumDistance: 24).onEnded { value in
      let width = value.translation.width
      guard abs(width) > 50, abs(width) > abs(value.translation.height),
        let index = modes.firstIndex(where: { $0.id == modeID })
      else { return }
      let next = index + (width < 0 ? 1 : -1)
      if modes.indices.contains(next) { modeID = modes[next].id }
    }
  }
}
