import AtdAI
import AtdModel
import SwiftUI

/// The frozen photo, fitted above the result sheet, with the answer marked on it: for 翻译 a
/// highlighter swipe under each item's lines, its number and a pin with the translation; for a
/// card a numbered box (a dashed region on a whiteboard) around the lines each part was read
/// from. While the photo is being read, a light sweeps over it.
///
/// The marks are artwork on the photo; VoiceOver reads the sheet, which carries everything.
struct CameraStage: View {
  let shot: CameraShot
  let answer: CameraAnswer?
  let reading: Bool
  /// How much of the screen's bottom the result sheet covers.
  let bottomInset: CGFloat
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// At most this many pins; the sheet lists every item.
  static let pinLimit = 12

  var body: some View {
    GeometryReader { geometry in
      let sheet = max(bottomInset - geometry.safeAreaInsets.bottom, 0)
      let area = CGRect(
        x: 12, y: 56, width: geometry.size.width - 24,
        height: max(geometry.size.height - 56 - sheet - 8, 80))
      let photo = CameraLayout.aspectFit(shot.size, in: area)
      ZStack(alignment: .topLeading) {
        Image(decorative: shot.image, scale: 1)
          .resizable()
          .frame(width: photo.width, height: photo.height)
          .offset(x: photo.minX, y: photo.minY)
        if let answer { marks(answer, in: photo) }
        if reading, !reduceMotion { sweep(over: photo) }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .animation(reduceMotion ? nil : .spring(duration: 0.45, bounce: 0), value: bottomInset)
    }
    .background(Color.black.ignoresSafeArea())
    .overlay(alignment: .top) {
      if reading, answer == nil {
        Text(CameraCopy.string("camera.reading"))
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .background(.black.opacity(0.6), in: Capsule())
          .padding(.top, 10)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(CameraCopy.string("camera.photo"))
    .accessibilityAddTraits(.isImage)
  }

  @ViewBuilder
  private func marks(_ answer: CameraAnswer, in photo: CGRect) -> some View {
    switch answer {
    case .translation(let translation):
      let pinned = translation.items.filter { !$0.lines.isEmpty }.prefix(Self.pinLimit)
      Path { path in
        for item in pinned {
          for quad in quads(item.lines) {
            path.addLines(CameraLayout.swipe(quad, in: photo))
            path.closeSubpath()
          }
        }
      }
      .fill(Color.yellow.opacity(0.42))
      .blendMode(.multiply)
      CameraPinLayout(
        anchors: pinned.map { box($0.lines, in: photo) }, area: inset(photo),
        text: text(in: photo)
      ) {
        ForEach(Array(pinned)) { item in
          CameraPin(number: item.id) {
            Text(item.text)
            if let approx = item.approx {
              Text(approx).fontWeight(.bold).foregroundStyle(.yellow)
            }
          }
        }
      }
    case .card(let card, let marks):
      let dashed = card.kind == .notes
      ForEach(marks) { mark in
        let frame = box(mark.lines, in: photo).insetBy(dx: -4, dy: -4)
        RoundedRectangle(cornerRadius: 6)
          .stroke(Color.yellow, style: StrokeStyle(lineWidth: 2, dash: dashed ? [7, 5] : []))
          .frame(width: frame.width, height: frame.height)
          .offset(x: frame.minX, y: frame.minY)
      }
      CameraPinLayout(
        anchors: marks.map { box($0.lines, in: photo) }, area: inset(photo),
        text: text(in: photo), besideFirst: true
      ) {
        ForEach(marks) { mark in
          CameraPin(number: mark.number) {
            Text(CameraMarkName.names(mark.fields, in: card))
          }
        }
      }
    }
  }

  private func quads(_ ids: [Int]) -> [CameraQuad] {
    ids.compactMap { id in shot.lines.first { $0.id == id }?.quad }
  }

  /// Every text line's box on the stage.
  private func text(in photo: CGRect) -> [CGRect] {
    shot.lines.map { CameraLayout.rect($0.quad.bounds, in: photo) }
  }

  /// Where labels may go: the photo, kept off its edges.
  private func inset(_ photo: CGRect) -> CGRect {
    photo.insetBy(dx: 4, dy: 4)
  }

  /// The lines' box on the stage.
  private func box(_ ids: [Int], in photo: CGRect) -> CGRect {
    CameraLayout.bounds(of: quads(ids)).map { CameraLayout.rect($0, in: photo) } ?? .zero
  }

  private func sweep(over photo: CGRect) -> some View {
    TimelineView(.animation) { context in
      let period = 1.6
      let progress =
        context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
      LinearGradient(
        colors: [.clear, .white.opacity(0.4), .clear], startPoint: .top, endPoint: .bottom
      )
      .frame(height: 90)
      .offset(y: -45 + photo.height * progress)
      .frame(width: photo.width, height: photo.height, alignment: .top)
      .clipped()
    }
    .offset(x: photo.minX, y: photo.minY)
    .allowsHitTesting(false)
  }
}

/// The names of the parts a mark stands for: 商家, 日期 · 时间, or a section's heading.
enum CameraMarkName {
  static func names(_ fields: [CameraMarkField], in card: CardResult) -> String {
    fields.map { name($0, in: card) }.joined(separator: " · ")
  }

  static func name(_ field: CameraMarkField, in card: CardResult) -> String {
    switch field {
    case .merchant: CameraCopy.string("camera.mark.merchant")
    case .time: CameraCopy.string("camera.mark.time")
    case .total: CameraCopy.string("camera.mark.total")
    case .date: CameraCopy.string("camera.mark.date")
    case .place: CameraCopy.string("camera.mark.place")
    case .section(let position):
      if case .notes(let notes) = card, notes.sections.indices.contains(position - 1) {
        notes.sections[position - 1].heading
      } else {
        CameraCopy.string("camera.mark.section")
      }
    }
  }

  /// The number of the mark that stands for `field`, if one does.
  static func number(of field: CameraMarkField, in marks: [CameraMark]) -> Int? {
    marks.first { $0.fields.contains(field) }?.number
  }
}
