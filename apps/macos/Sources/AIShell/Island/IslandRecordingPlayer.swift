import AICore
import AVFoundation
import AppKit
import SwiftUI

/// The recording's player, on the result card and on its lightbox's stage: the recording at its
/// own shape, on black in a 10 pt corner, with a round play button over it while it is paused.
/// A click plays or pauses; a double-click opens the card's lightbox, or in the lightbox goes
/// back to the card (the click waits for the double-click's time to pass). Both show the card's
/// one `AVPlayer`, so they show the same frame: a preview's while one stands in for the playhead.
/// The card's tells the card where it is, which the lightbox grows from and goes back to.
struct IslandRecordingPlayer: View {
  let card: IslandRecordingCardModel
  let labels: IslandRecordingLabels
  let size: WindowSize
  /// The tooltip, which says what a double-click does here.
  let hint: String
  /// The card's player reports its frame (``IslandRecordingCardModel/mediaFrame``); the
  /// lightbox's does not.
  var reportsFrame = false
  let doubleClick: () -> Void

  var body: some View {
    let shape = RoundedRectangle(
      cornerRadius: IslandMetrics.recordingPlayerRadius, style: .continuous)
    ZStack {
      Color.black
      IslandRecordingVideo(player: card.playback.player)
      if !card.playing {
        IslandGlyph(name: IslandIcons.play, side: 20)
          .foregroundStyle(.white)
          .offset(x: 1)
          .frame(width: 44, height: 44)
          .background { Circle().fill(Color.black.opacity(0.45)) }
          .allowsHitTesting(false)
          .transition(.opacity)
      }
    }
    .frame(width: size.width, height: size.height)
    .clipShape(shape)
    .contentShape(shape)
    .animation(.easeOut(duration: 0.15), value: card.playing)
    .gesture(
      TapGesture(count: 2)
        .onEnded { doubleClick() }
        .exclusively(before: TapGesture().onEnded { card.togglePlay() })
    )
    .onGeometryChange(for: CGRect.self) {
      $0.frame(in: .global)
    } action: {
      if reportsFrame { card.mediaFrame = $0 }
    }
    .help(hint)
    .accessibilityElement()
    .accessibilityLabel(Text(verbatim: card.playing ? labels.pause : labels.play))
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { card.togglePlay() }
  }
}

/// The movie in an `AVPlayerLayer`, drawn as it is: the view opts out of the glass's vibrancy
/// (as the island's other AppKit pieces do, ``IslandPlainHost``), which would otherwise blend
/// the video with the glass, and takes no clicks, which the player's gestures read.
struct IslandRecordingVideo: NSViewRepresentable {
  let player: AVPlayer

  func makeNSView(context: Context) -> IslandPlayerView { IslandPlayerView(player: player) }

  func updateNSView(_ view: IslandPlayerView, context: Context) {
    if view.playerLayer.player !== player { view.playerLayer.player = player }
  }
}

final class IslandPlayerView: NSView {
  let playerLayer = AVPlayerLayer()

  init(player: AVPlayer) {
    super.init(frame: .zero)
    playerLayer.player = player
    playerLayer.videoGravity = .resizeAspect
    playerLayer.backgroundColor = NSColor.black.cgColor
    wantsLayer = true
    layer?.addSublayer(playerLayer)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var allowsVibrancy: Bool { false }

  override func layout() {
    super.layout()
    // SwiftUI supplies the interpolated bounds. AVPlayerLayer's implicit resize would lag
    // behind the player clip and the glass, running a second animation on every frame.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
