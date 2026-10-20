import AppKit

/// Focus mode's layer over the grid. It borrows the focused tile's picture and holds it in the
/// focus frame, and it moves the picture between the tile's slot and that frame
/// (``ComputerMonitorMorph``) while the content fades the grid. Because the picture is the same
/// view throughout, its video keeps running and is fitted to every intermediate frame.
///
/// The stage covers the whole content but takes only what its picture takes (the status action),
/// so in grid mode every press reaches the tiles under it.
final class ComputerMonitorStage: NSView {
  /// The morph's length and its stand-in under Reduce Motion, a crossfade.
  static let morphDuration: CFTimeInterval = 0.3
  static let crossfadeDuration: CFTimeInterval = 0.2

  private let morph = ComputerMonitorMorph()
  /// The borrowed picture, nil in grid mode.
  private(set) var picture: ComputerMonitorPicture?

  /// The focused picture's frame in the stage's coordinates, which the content's layout sets. A
  /// running morph reads it on every step, so a resize during the morph still lands on it.
  var focusFrame: CGRect = .zero {
    didSet {
      if !morph.isRunning, let picture, picture.superview === self { picture.frame = focusFrame }
    }
  }

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit === self ? nil : hit
  }

  /// Takes `picture` from `slot` to the focus frame, calling `fade` with the progress on every
  /// step. Without `animated` it lands at once and the content crossfades.
  func enter(
    _ picture: ComputerMonitorPicture, from slot: CGRect, animated: Bool,
    fade: @escaping (CGFloat) -> Void, completion: @escaping () -> Void
  ) {
    morph.finish()
    self.picture = picture
    addSubview(picture)
    picture.frame = slot
    guard animated else {
      picture.frame = focusFrame
      fade(1)
      completion()
      return
    }
    morph.run(on: self, duration: Self.morphDuration) { [weak self] progress in
      guard let self else { return }
      self.place(picture, ComputerMonitorLayout.interpolate(slot, self.focusFrame, progress))
      fade(progress)
    } completion: {
      completion()
    }
  }

  /// Takes the picture from the focus frame back to its tile's slot (`slot`, read on every step
  /// because the grid can scroll or resize meanwhile), then hands it over to `completion`, which
  /// puts it back into the tile. Without `animated` it is handed over at once.
  func leave(
    to slot: @escaping () -> CGRect, animated: Bool, fade: @escaping (CGFloat) -> Void,
    completion: @escaping (ComputerMonitorPicture) -> Void
  ) {
    morph.finish()
    guard let picture else { return }
    self.picture = nil
    guard animated else {
      fade(1)
      completion(picture)
      return
    }
    let start = picture.frame
    morph.run(on: self, duration: Self.morphDuration) { [weak self] progress in
      self?.place(picture, ComputerMonitorLayout.interpolate(start, slot(), progress))
      fade(progress)
    } completion: {
      completion(picture)
    }
  }

  /// Shows `next` in the focus frame instead of the current picture, which goes to `returning`,
  /// with a short crossfade on the stage.
  func swap(
    to next: ComputerMonitorPicture, returning: (ComputerMonitorPicture) -> Void
  ) {
    morph.finish()
    let fade = CATransition()
    fade.type = .fade
    fade.duration = 0.15
    layer?.add(fade, forKey: kCATransition)
    if let picture { returning(picture) }
    picture = next
    addSubview(next)
    next.frame = focusFrame
  }

  /// Ends a running morph at its end state, so a new transition starts from a settled layout.
  func finish() { morph.finish() }

  /// Gives the picture up without a transition, for a focused source that went away.
  func release() -> ComputerMonitorPicture? {
    morph.finish()
    defer { picture = nil }
    return picture
  }

  /// One step: the frame, then the picture's own layout at once, so its video fits the new frame
  /// in the same Core Animation transaction.
  private func place(_ picture: ComputerMonitorPicture, _ frame: CGRect) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    picture.frame = frame
    picture.layoutSubtreeIfNeeded()
    CATransaction.commit()
  }
}
