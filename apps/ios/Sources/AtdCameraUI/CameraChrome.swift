import AVFoundation
import AtdInk
import SwiftUI

/// The camera's picture: the live session, filling its space.
struct CameraPreview: UIViewRepresentable {
  let session: AVCaptureSession

  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView()
    view.preview.session = session
    view.preview.videoGravity = .resizeAspectFill
    return view
  }

  func updateUIView(_ view: PreviewView, context: Context) {}

  final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    // The layer is always the class above.
    // swiftlint:disable:next force_cast
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  }
}

/// A round control on the camera: white ink on a dim wash, readable over any picture. No glass:
/// the picture is the content.
struct RimButtonStyle: ButtonStyle {
  var seed = 3

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 17, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: 44, height: 44)
      .background {
        let shape = InkShape(corners: .round, seed: seed)
        shape.fill(.black.opacity(configuration.isPressed ? 0.5 : 0.3))
        shape.stroke(.white.opacity(0.85), lineWidth: 1.2)
      }
      .contentShape(Circle())
  }
}

/// The shutter: a hand-drawn white ring around a white disc.
struct ShutterButton: View {
  let isEnabled: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Circle()
        .fill(.white)
        .frame(width: 64, height: 64)
        .padding(9)
        .overlay {
          InkShape(corners: .round, wobble: 0.9, seed: 21).stroke(.white, lineWidth: 3)
        }
    }
    .buttonStyle(ShutterStyle())
    .disabled(!isEnabled)
    .opacity(isEnabled ? 1 : 0.4)
    .accessibilityLabel(ViewfinderText.string("viewfinder.shutter"))
  }

  private struct ShutterStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
      configuration.label.scaleEffect(configuration.isPressed ? 0.92 : 1)
    }
  }
}

/// The mode's first option on a chip, such as 译成 中文; a menu changes it.
struct OptionChip: View {
  let option: CameraModeOption
  let value: String
  let choose: (String) -> Void

  var body: some View {
    Menu {
      Picker(option.label, selection: Binding(get: { value }, set: { choose($0) })) {
        ForEach(option.choices, id: \.self) { Text($0).tag($0) }
      }
    } label: {
      HStack(spacing: 5) {
        Text(option.label).foregroundStyle(.white.opacity(0.75))
        Text(value).fontWeight(.semibold)
        Image(systemName: "chevron.down").font(.caption.weight(.bold))
      }
      .font(.subheadline)
      .foregroundStyle(.white)
      .lineLimit(1)
      .padding(.horizontal, 14)
      .frame(minHeight: 36)
      .background {
        let shape = InkShape(corners: .chip, seed: 13)
        shape.fill(.black.opacity(0.3))
        shape.stroke(.white.opacity(0.85), lineWidth: 1.1)
      }
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .accessibilityLabel(option.label)
    .accessibilityValue(value)
  }
}

/// Four white corners around the middle of the picture, where a page or a menu should go.
struct GuideCorners: Shape {
  func path(in rect: CGRect) -> Path {
    let width = min(rect.width * 0.78, rect.height * 0.6 * 3 / 4)
    let height = width * 4 / 3
    let box = CGRect(
      x: rect.midX - width / 2, y: rect.midY - height / 2 - 20, width: width, height: height)
    let arm: CGFloat = 26
    var path = Path()
    for (corner, dx, dy) in [
      (CGPoint(x: box.minX, y: box.minY), arm, arm),
      (CGPoint(x: box.maxX, y: box.minY), -arm, arm),
      (CGPoint(x: box.maxX, y: box.maxY), -arm, -arm),
      (CGPoint(x: box.minX, y: box.maxY), arm, -arm),
    ] {
      path.move(to: CGPoint(x: corner.x + dx, y: corner.y))
      path.addLine(to: corner)
      path.addLine(to: CGPoint(x: corner.x, y: corner.y + dy))
    }
    return path
  }
}

/// The viewfinder's copy, in this module's string catalog.
enum ViewfinderText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }
}
