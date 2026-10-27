import AppKit
import SwiftUI

/// A continuous color field throughout the command, inside its existing glass and clip.
struct IslandWorkingGlow: NSViewRepresentable {
  let active: Bool
  var motionEnabled = true
  /// Fixed for the view's life; ``IslandPaletteGlow`` cross-fades two fields instead.
  var palette = IslandGlowPalette.working

  func makeNSView(context: Context) -> IslandPlainHost<IslandWorkingGlowView> {
    let host = IslandPlainHost(
      IslandWorkingGlowView(active: active, motionEnabled: motionEnabled, palette: palette))
    host.setAccessibilityElement(false)
    host.content.update(active: active, motionEnabled: motionEnabled)
    return host
  }

  func updateNSView(_ host: IslandPlainHost<IslandWorkingGlowView>, context: Context) {
    host.content.update(active: active, motionEnabled: motionEnabled)
  }

  static func dismantleNSView(
    _ host: IslandPlainHost<IslandWorkingGlowView>, coordinator: ()
  ) {
    host.content.detach()
  }

  func sizeThatFits(
    _ proposal: ProposedViewSize, nsView: IslandPlainHost<IslandWorkingGlowView>, context: Context
  ) -> CGSize? {
    CGSize(width: proposal.width ?? 0, height: proposal.height ?? 0)
  }
}

/// AppKit owns visibility and appearance; the nested host owns only the background's updates.
/// No frame tick changes the island's model, layout, foreground controls, or outer hosting view.
/// With the user's glow effects off (``GlowEffects``) the field stays dark whatever `active` says,
/// and fades out like any other end when they are turned off while it shows.
final class IslandWorkingGlowView: NSView {
  private let field: IslandGlowFieldState
  private let palette: IslandGlowPalette
  private let hostingView: IslandGlowHostingView
  private var active: Bool
  private var motionEnabled: Bool
  private var retreating = false
  private var retreat: Task<Void, Never>?
  private var observers: [(center: NotificationCenter, token: NSObjectProtocol)] = []

  init(active: Bool, motionEnabled: Bool, palette: IslandGlowPalette) {
    self.active = active
    self.motionEnabled = motionEnabled
    let field = IslandGlowFieldState(active: active && GlowEffects.shared.enabled)
    self.field = field
    self.palette = palette
    hostingView = IslandGlowHostingView(rootView: IslandGlowField(state: field, palette: palette))
    super.init(frame: .zero)
    addSubview(hostingView)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var allowsVibrancy: Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func update(active: Bool, motionEnabled: Bool) {
    self.active = active
    self.motionEnabled = motionEnabled
    syncField()
  }

  override func layout() {
    super.layout()
    if hostingView.frame != bounds { hostingView.frame = bounds }
    syncField()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    syncField()
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    removeObservers()
    // SwiftUI reparents this same view during a morph. Preserve the fade deadline across
    // that move; only detach or a new active state cancels it. Invisible windows still pause.
    field.pause()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let window {
      observe(NotificationCenter.default, NSWindow.didChangeOcclusionStateNotification, window)
      observe(
        NSWorkspace.shared.notificationCenter,
        NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, nil)
      observe(NotificationCenter.default, GlowEffects.didChange, nil)
    }
    needsLayout = true
    syncField()
  }

  func detach() {
    active = false
    removeObservers()
    stopRetreat()
    field.pause()
  }

  private func stopRetreat() {
    retreat?.cancel()
    retreat = nil
    retreating = false
  }

  private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ object: Any?) {
    let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
      MainActor.assumeIsolated { self?.syncField() }
    }
    observers.append((center, token))
  }

  private func removeObservers() {
    for observer in observers { observer.center.removeObserver(observer.token) }
    observers = []
  }

  private func syncField() {
    let workspace = NSWorkspace.shared
    let active = active && GlowEffects.shared.enabled
    if active != field.active {
      stopRetreat()
      if !active {
        // Keep the field moving throughout its fade, then stop hidden frame updates.
        retreating = true
        let duration =
          workspace.accessibilityDisplayShouldReduceMotion
          ? IslandGlowStyle.reducedMotionDuration : IslandGlowStyle.exitDuration
        retreat = Task { [weak self] in
          do { try await Task.sleep(for: .seconds(duration)) } catch { return }
          guard !Task.isCancelled, let self else { return }
          retreating = false
          retreat = nil
          syncField()
        }
      }
    }
    let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    let contrast = workspace.accessibilityDisplayShouldIncreaseContrast ? 0.4 : 1.0
    let transparency = workspace.accessibilityDisplayShouldReduceTransparency ? 0.6 : 1.0
    let strength = (dark ? 0.34 : 0.15) * palette.emphasis(dark: dark) * contrast * transparency
    let running =
      (active || retreating) && motionEnabled
      && window?.occlusionState.contains(.visible) == true
      && !isHiddenOrHasHiddenAncestor && bounds.width > 0 && bounds.height > 0
      && !workspace.accessibilityDisplayShouldReduceMotion
    field.update(active: active, strength: strength, running: running)
  }
}

private final class IslandGlowHostingView: NSHostingView<IslandGlowField> {
  required init(rootView: IslandGlowField) {
    super.init(rootView: rootView)
    sizingOptions = []
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var allowsVibrancy: Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
