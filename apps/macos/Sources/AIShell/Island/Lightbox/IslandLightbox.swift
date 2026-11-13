import AICore
import AppKit
import Carbon.HIToolbox
import SwiftUI

/// A result card's full-screen preview: the card's media over a dark scrim covering the island's
/// screen, with the chrome to work on it there (decision: the result preview's direction A). Each
/// card's presenter owns one (``IslandLongScreenshot``, ``IslandRecording``) and gives it the
/// content to show (``IslandLightboxContent``), made for the card model the card and the lightbox
/// share. The card stays on the island under the scrim.
///
/// The lightbox owns the window, the scrim, the keyboard while it shows, and the motion's timing:
/// opening, the media grows from the card's own (``open(on:from:returningKeyTo:content:)``'s
/// `origin`) while the scrim fades in, and the chrome follows once it has landed; closing
/// reverses it into the card's media, after which the keyboard goes back to the card. Under
/// Reduce Motion the whole lightbox fades instead. Closing never changes the card's state.
final class IslandLightbox {
  let model = IslandLightboxModel()
  private(set) var content: (any IslandLightboxContent)?
  private var window: IslandLightboxWindow?
  private var host: NSHostingView<IslandLightboxRoot>?
  /// The window that had the keyboard when the lightbox opened, which takes it back.
  private weak var returnKey: NSWindow?
  /// Bumped by every open and close, so a step scheduled for one never runs for the next.
  private var generation = 0
  private var screenObserver: NSObjectProtocol?
  private let keyboard = KeyboardHandoff()

  init() {
    model.onClose = { [weak self] in self?.close() }
  }

  /// Something shows, or is closing.
  var isOpen: Bool { content != nil }

  /// The lightbox has the keyboard.
  var isKey: Bool { window?.isKeyWindow == true }

  /// Restores key-window focus to the lightbox when it is open and visible after a modal dialog.
  func makeKeyIfVisible() {
    guard isOpen, let window, window.isVisible, window.canBecomeKey else { return }
    window.makeKey()
  }

  /// Opens over `screen`, the media growing from `origin` (screen points, Cocoa coordinates; nil
  /// fades it in), with the content `make` builds for the lightbox's model; the keyboard goes
  /// back to `returningKeyTo` once it closes. Nothing happens while one is open.
  func open(
    on screen: NSScreen, from origin: CGRect?, returningKeyTo: NSWindow?,
    content make: (IslandLightboxModel) -> any IslandLightboxContent
  ) {
    guard content == nil else { return }
    keyboard.cancel()
    generation += 1
    let generation = generation
    let frame = screen.frame
    model.size = frame.size
    model.safe = Self.insets(of: screen)
    model.origin = origin.map { Self.local($0, in: frame) }
    model.reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    model.phase = .entering
    model.chromeShown = false
    let content = make(model)
    self.content = content
    returnKey = returningKeyTo
    let window = window ?? makeWindow()
    host?.rootView = IslandLightboxRoot(model: model, content: content.view)
    window.setFrame(frame, display: false)
    window.orderFrontRegardless()
    keyboard.perform { [weak self, weak window] in
      guard let self, self.generation == generation, let window, window.isVisible else { return }
      window.makeKey()
    }
    observeScreens()
    // The first frame stands the media on the card's; the next one moves it.
    DispatchQueue.main.async { [weak self] in
      guard let self, self.generation == generation else { return }
      let reduced = model.reduceMotion || model.origin == nil
      withAnimation(
        reduced
          ? .easeOut(duration: IslandChoreography.lightboxReducedFade)
          : .spring(response: IslandChoreography.lightboxOpen, dampingFraction: 1)
      ) { model.phase = .shown }
      after(reduced ? 0 : IslandChoreography.lightboxOpen, generation) { [weak self] in
        withAnimation(.easeOut(duration: IslandChoreography.lightboxChromeFade)) {
          self?.model.chromeShown = true
        }
      }
    }
  }

  /// Closes into the card's media, now at `origin` (screen points; nil keeps where it opened
  /// from), or at once without `animated` (the card left the island).
  func close(animated: Bool = true, origin: CGRect? = nil) {
    guard let content, model.phase != .leaving || !animated else { return }
    keyboard.cancel()
    generation += 1
    let generation = generation
    content.willClose()
    if let origin, let frame = window?.frame { model.origin = Self.local(origin, in: frame) }
    guard animated else { return finish() }
    let reduced = model.reduceMotion || model.origin == nil
    withAnimation(.easeOut(duration: IslandChoreography.lightboxChromeFade)) {
      model.chromeShown = false
    }
    withAnimation(
      reduced
        ? .easeOut(duration: IslandChoreography.lightboxReducedFade)
        : .spring(response: IslandChoreography.lightboxClose, dampingFraction: 1)
    ) { model.phase = .leaving }
    after(
      reduced ? IslandChoreography.lightboxReducedFade : IslandChoreography.lightboxClose,
      generation
    ) { [weak self] in self?.finish() }
  }

  /// The window goes, its content with it, and the keyboard goes back to the card.
  private func finish() {
    generation += 1
    let returnsKeyboard = window?.isKeyWindow == true
    window?.orderOut(nil)
    host?.rootView = IslandLightboxRoot(model: model, content: AnyView(EmptyView()))
    content = nil
    if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
    screenObserver = nil
    if returnsKeyboard, let returnKey {
      keyboard.perform { [weak returnKey] in
        guard let returnKey, returnKey.isVisible, returnKey.canBecomeKey else { return }
        returnKey.makeKey()
      }
    }
    returnKey = nil
  }

  private func after(_ seconds: Double, _ generation: Int, _ step: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
      guard let self, self.generation == generation else { return }
      step()
    }
  }

  /// A display added, removed or rearranged: the screen under the lightbox may be gone or moved,
  /// so it closes at once.
  private func observeScreens() {
    guard screenObserver == nil else { return }
    screenObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.close(animated: false) } }
  }

  // MARK: Keys

  private func key(_ event: NSEvent) -> Bool {
    guard let content else { return false }
    if content.key(event) { return true }
    guard Int(event.keyCode) == kVK_Escape else { return false }
    close()
    return true
  }

  private func makeWindow() -> IslandLightboxWindow {
    let host = NSHostingView(
      rootView: IslandLightboxRoot(model: model, content: AnyView(EmptyView())))
    host.sizingOptions = []
    let window = IslandLightboxWindow(content: host)
    window.onKeyDown = { [weak self] in self?.key($0) ?? false }
    window.onKeyUp = { [weak self] in self?.content?.keyUp($0) ?? false }
    window.onFlagsChanged = { [weak self] in self?.content?.flagsChanged($0) }
    window.onKeyEquivalent = { [weak self] in self?.content?.keyEquivalent($0) ?? false }
    window.onKeyboardLost = { [weak self] in self?.content?.keyboardLost() }
    self.window = window
    self.host = host
    return window
  }

  // MARK: Geometry

  /// `rect` (screen points, Cocoa) in the lightbox's coordinates over `frame`, top-left origin.
  static func local(_ rect: CGRect, in frame: CGRect) -> CGRect {
    CGRect(
      x: rect.minX - frame.minX, y: frame.maxY - rect.maxY, width: rect.width,
      height: rect.height)
  }

  /// The screen's work area as insets from its frame.
  static func insets(of screen: NSScreen) -> EdgeInsets {
    let frame = screen.frame
    let visible = screen.visibleFrame
    return EdgeInsets(
      top: frame.maxY - visible.maxY, leading: visible.minX - frame.minX,
      bottom: visible.minY - frame.minY, trailing: frame.maxX - visible.maxX)
  }
}
