import AtdInk
import SwiftUI

/// The camera's modes under the picture, the chosen one marked with yellow highlighter and slid
/// to the middle. Tapping a mode chooses it; so does swiping the picture (`CameraViewfinder`).
/// VoiceOver reads the strip as one adjustable control.
struct CameraModeStrip: View {
  let modes: [CameraMode]
  @Binding var selection: String?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geometry in
      ScrollView(.horizontal) {
        HStack(spacing: 4) {
          ForEach(modes) { mode in
            label(mode)
          }
        }
        .scrollTargetLayout()
      }
      .scrollIndicators(.hidden)
      .scrollDisabled(true)
      // Room on both sides, so the first and the last mode can slide to the middle too.
      .contentMargins(.horizontal, geometry.size.width / 2, for: .scrollContent)
      .scrollPosition(id: $selection, anchor: .center)
    }
    .frame(height: 44)
    .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: selection)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(ViewfinderText.string("viewfinder.modes"))
    .accessibilityValue(modes.first { $0.id == selection }?.name ?? "")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: step(1)
      case .decrement: step(-1)
      @unknown default: break
      }
    }
  }

  private func label(_ mode: CameraMode) -> some View {
    let chosen = mode.id == selection
    return Button {
      selection = mode.id
    } label: {
      Text(mode.name)
        .font(.subheadline.weight(chosen ? .semibold : .regular))
        .foregroundStyle(.white.opacity(chosen ? 1 : 0.78))
        .lineLimit(1)
        .fixedSize()
        .padding(.horizontal, 12)
        .frame(minHeight: 34)
        .background {
          if chosen {
            InkShape(corners: .chip, wobble: 0.6, seed: inkSeed(mode.id)).fill(InkColor.chosen)
          }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .id(mode.id)
  }

  /// Chooses the mode `offset` places along, if there is one.
  private func step(_ offset: Int) {
    guard let index = modes.firstIndex(where: { $0.id == selection }) else { return }
    let next = index + offset
    if modes.indices.contains(next) { selection = modes[next].id }
  }
}
