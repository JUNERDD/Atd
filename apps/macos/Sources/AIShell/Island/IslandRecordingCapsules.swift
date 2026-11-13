import AICore
import SwiftUI

/// The recording capsule (architecture R7, `island.js`): the grip, the red dot, the timer, what
/// is happening and the microphone's level, then the microphone toggle, pause or resume,
/// discard and Stop. Its width changes only for a new hour digit, so ordinary timer ticks and
/// microphone changes keep its controls under the pointer: the timer reserves
/// ``RecordingClock/reserved(for:)``, the words reserve the wider of both, and the meter keeps
/// its room as a grey flat line while the microphone is off.
/// Its live values come from ``IslandModel/recording`` as often as the recording ticks; the
/// controls take only their ``RecordingCapsule/Face``, so a tick replaces no glyph, and their
/// glyphs take no clicks, so a click lands on the button whatever a tick redraws.
struct IslandRecordingCapsule: View {
  let model: IslandModel

  var body: some View {
    let capsule = model.recording
    let labels = model.labels.recording
    HStack(spacing: IslandMetrics.gap) {
      IslandGrip(model: model, secondary: true)
      IslandRecordingReadout(capsule: capsule, labels: labels)
        .padding(.leading, 8)
        .padding(.trailing, 8)
      IslandRecordingControls(
        face: capsule.face, microphone: labels.microphone(capsule), labels: labels,
        send: model.recordingEvent)
    }
    .padding(.horizontal, IslandMetrics.padding)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: labels.capsule(RecordingClock.text(capsule.elapsed))))
  }
}

/// The dot, the timer, the status words and the level meter.
private struct IslandRecordingReadout: View {
  let capsule: RecordingCapsule
  let labels: IslandRecordingLabels

  var body: some View {
    HStack(spacing: 6) {
      IslandRecordingDot(paused: capsule.paused)
      IslandStableText(
        text: RecordingClock.text(capsule.elapsed),
        reserve: [RecordingClock.reserved(for: capsule.elapsed)]
      )
      .monospacedDigit()
      IslandStableText(
        text: capsule.paused ? labels.paused : labels.recording,
        reserve: [labels.recording, labels.paused])
      IslandRecordingMeter(bars: capsule.meter, on: capsule.microphoneOn)
    }
    .font(IslandType.label)
    .accessibilityHidden(true)
  }
}

/// The capsule's buttons, built from their face and the microphone's name only: a tick that
/// changes neither leaves every glyph as it is.
private struct IslandRecordingControls: View {
  let face: RecordingCapsule.Face
  let microphone: String
  let labels: IslandRecordingLabels
  let send: (IslandRecordingEvent) -> Void

  var body: some View {
    HStack(spacing: IslandMetrics.gap) {
      IslandIconButton(
        glyph: face.microphoneOn ? IslandIcons.microphone : IslandIcons.microphoneOff,
        label: microphone
      ) { send(.micToggle) }
      IslandIconButton(
        glyph: face.paused ? IslandIcons.play : IslandIcons.pause,
        label: face.paused ? labels.resume : labels.pause
      ) { send(face.paused ? .resume : .pause) }
      IslandRule()
      IslandIconButton(
        glyph: IslandIcons.discard, label: labels.discard
      ) { send(.discard) }
      IslandRecordButton(
        title: labels.stop, glyph: IslandIcons.stop, glyphSide: 12,
        tooltip: labels.stopRecording + " ⌃⌘Esc"
      ) { send(.stop) }
    }
  }
}

/// The recording is being processed (`outcome` nil: a spinner), or a result went somewhere (a
/// check) or could not (a warning): the status capsule of `writing` and `done`, with the
/// recording's words.
struct IslandRecordingStatus: View {
  let message: String
  let outcome: IslandRecording.StatusKind?

  var body: some View {
    HStack(spacing: 6) {
      IslandRecordingOutcomeGlyph(outcome: outcome)
      Text(verbatim: message)
        .font(IslandType.label)
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(width: IslandType.width(of: message, limit: IslandMetrics.maxMessageWidth))
        .help(message)
    }
    .padding(.leading, IslandMetrics.padding + 8)
    .padding(.trailing, IslandMetrics.padding + 10)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(verbatim: message))
  }
}

/// The capsule asks before it throws the recording away: Keep Recording goes back to it,
/// Discard throws it away.
struct IslandRecordingDiscard: View {
  let model: IslandModel
  let elapsed: String

  var body: some View {
    let labels = model.labels.recording
    HStack(spacing: IslandMetrics.gap) {
      Text(verbatim: labels.discardQuestion(elapsed))
        .font(IslandType.label)
        .lineLimit(1)
        .fixedSize()
        .padding(.leading, 8)
        .padding(.trailing, 8)
      IslandTextButton(title: labels.keepRecording) {
        model.recordingEvent(.keepRecording)
      }
      IslandRecordButton(title: labels.confirmDiscard, glyph: IslandIcons.discard) {
        model.recordingEvent(.confirmDiscard)
      }
    }
    .padding(.horizontal, IslandMetrics.padding)
    .accessibilityElement(children: .contain)
  }
}

/// The dot of a recording in progress: red, pulsing while it records (still under Reduce
/// Motion), dimmed while paused.
private struct IslandRecordingDot: View {
  let paused: Bool
  @State private var dim = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let pulses = !paused && !reduceMotion
    Circle()
      .fill(Color(nsColor: .systemRed))
      .frame(width: 10, height: 10)
      .opacity(paused ? 0.45 : pulses && dim ? 0.35 : 1)
      .animation(
        pulses ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : .default,
        value: dim
      )
      .onChange(of: pulses, initial: true) { _, pulsing in dim = pulsing }
  }
}

/// The microphone's level: four bars rising with it, or a grey flat line in the same room while
/// the microphone is off.
private struct IslandRecordingMeter: View {
  let bars: [Double]
  let on: Bool

  var body: some View {
    HStack(spacing: RecordingCapsule.meterGap) {
      ForEach(Array(bars.enumerated()), id: \.offset) { _, height in
        Capsule()
          .fill(on ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary))
          .frame(width: RecordingCapsule.meterBarWidth, height: height)
      }
    }
    .frame(width: RecordingCapsule.meterWidth, height: RecordingCapsule.meterHeight)
    .animation(.linear(duration: 0.12), value: bars)
  }
}

/// Text that keeps the width of the widest of `reserve` (and itself) whatever it shows, so a
/// value that changes never moves what is beside it (the prototype's `P.stable`).
struct IslandStableText: View {
  let text: String
  let reserve: [String]

  var body: some View {
    ZStack(alignment: .leading) {
      ForEach(reserve, id: \.self) { Text(verbatim: $0).hidden() }
      Text(verbatim: text)
    }
    .lineLimit(1)
    .fixedSize()
  }
}

/// A capsule's thin separator between groups of controls.
struct IslandRule: View {
  var body: some View {
    Rectangle()
      .fill(Color.primary.opacity(0.14))
      .frame(width: 1, height: 16)
      .padding(.horizontal, 4)
      .accessibilityHidden(true)
  }
}

/// The recording's red button (Stop, Discard): its glyph and title in white on the system red,
/// as the toolbars' record controls; the glyph takes no clicks.
struct IslandRecordButton: View {
  let title: String
  let glyph: String
  var glyphSide = 14.0
  var tooltip: String?
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        IslandGlyph(name: glyph, side: glyphSide).allowsHitTesting(false)
        Text(verbatim: title).font(IslandType.label).lineLimit(1).fixedSize()
      }
      .foregroundStyle(.white)
      .padding(.horizontal, 10)
      .frame(height: IslandMetrics.controlSide)
      .background {
        Capsule().fill(Color(nsColor: .systemRed))
          .overlay { Capsule().fill(Color.black.opacity(hovered ? 0.12 : 0)) }
      }
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .modifier(
      FloatingHover {
        hovered = $0
      }
    )
    .help(tooltip ?? title)
    .accessibilityLabel(Text(verbatim: tooltip ?? title))
  }
}
