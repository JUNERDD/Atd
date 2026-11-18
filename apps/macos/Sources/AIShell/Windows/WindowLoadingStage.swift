import AICore
import AppKit
import QuartzCore
import WebKit

/// Hosts a page window's `WebViewHost` beneath a native `WindowLoadingView` until the visible page
/// publishes its drag-region chrome readiness and commits an animation frame, transitioning cleanly
/// to a single-fill ``WindowRecoveryView`` if `dragRegionsReady` has not arrived after 5 seconds or
/// immediately when WebContent exhausts its 60-second crash budget (`03` §4.3).
final class WindowLoadingStage {
  let view = NSView()
  let fallbackDuration: Duration
  private weak var host: WebViewHost?
  private weak var window: NSWindow?
  private let titleKey: ShellStringKey
  private(set) var loadingView: WindowLoadingView?
  private(set) var recoveryView: WindowRecoveryView?
  private var pendingRecoveryReason: WindowRecoveryView.Reason?
  private var windowVisible = false
  private var dragRegionsReady = false
  private var revealing = false
  private var revealGeneration = 0
  private var revealTask: Task<Void, Never>?

  var serviceContextOverride: (() -> WindowRecoveryView.ServiceContext)?
  var onRestartServiceOverride: (() async throws -> Void)?
  var onExportDiagnosticsOverride: (() async throws -> Bool)?
  var onReloadPageOverride: (() -> Void)?
  var animationFrameHook: ((WKWebView, @escaping (Bool) -> Void) -> Void)?

  init(
    host: WebViewHost,
    window: NSWindow,
    titleKey: ShellStringKey,
    fallbackDuration: Duration = .seconds(5)
  ) {
    self.host = host
    self.window = window
    self.titleKey = titleKey
    self.fallbackDuration = fallbackDuration
    view.wantsLayer = true
    host.container.wantsLayer = true
    host.container.alphaValue = 0
    host.container.frame = view.bounds
    host.container.autoresizingMask = [.width, .height]
    view.addSubview(host.container)
    installLoadingView()
    bindHostCallbacks()
  }

  isolated deinit { revealTask?.cancel() }

  func setWindowVisible(_ visible: Bool) {
    guard windowVisible != visible else { return }
    windowVisible = visible
    if !visible {
      revealGeneration &+= 1
      revealTask?.cancel()
      revealTask = nil
      revealing = false
      loadingView?.setActive(false)
      return
    }
    if host?.chromeReady == true {
      dragRegionsReady = true
      pendingRecoveryReason = nil
    }
    if let pendingReason = pendingRecoveryReason, !dragRegionsReady {
      presentRecovery(reason: pendingReason)
      return
    }
    if recoveryView != nil {
      if dragRegionsReady {
        scheduleRevealIfPossible()
      }
      return
    }
    if loadingView == nil { installLoadingView() }
    loadingView?.setActive(true, delayContent: dragRegionsReady)
    armFallbackTimeout()
    scheduleRevealIfPossible()
  }

  func stop() {
    windowVisible = false
    dragRegionsReady = false
    revealing = false
    pendingRecoveryReason = nil
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    removeLoadingView()
    removeRecoveryView()
    host?.onDragRegionsReady = nil
    host?.onDragRegionsReset = nil
    host?.onCrashLoopExhausted = nil
  }

  private func bindHostCallbacks() {
    host?.onDragRegionsReady = { [weak self] in self?.handleDragRegionsReady() }
    host?.onDragRegionsReset = { [weak self] in self?.handleDragRegionsReset() }
    host?.onCrashLoopExhausted = { [weak self] in self?.handleCrashLoopExhausted() }
  }

  private func installLoadingView() {
    guard loadingView == nil else { return }
    removeRecoveryView()
    let loading = WindowLoadingView(frame: view.bounds, titleKey: titleKey)
    loading.autoresizingMask = [.width, .height]
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 0
    view.addSubview(loading)
    CATransaction.commit()
    loadingView = loading
  }

  private func removeLoadingView() {
    loadingView?.stop()
    loadingView?.removeFromSuperview()
    loadingView = nil
  }

  private func removeRecoveryView() {
    recoveryView?.stop()
    recoveryView?.removeFromSuperview()
    recoveryView = nil
  }

  func handleDragRegionsReady() {
    dragRegionsReady = true
    pendingRecoveryReason = nil
    scheduleRevealIfPossible()
  }

  func handleDragRegionsReset() {
    dragRegionsReady = false
    revealing = false
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    if pendingRecoveryReason == .crashed { return }
    removeRecoveryView()
    installLoadingView()
    bindHostCallbacks()
    if windowVisible {
      loadingView?.setActive(true, delayContent: false)
      armFallbackTimeout()
    }
  }

  func handleCrashLoopExhausted() {
    dragRegionsReady = false
    revealing = false
    pendingRecoveryReason = .crashed
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    presentRecovery(reason: .crashed)
  }

  private func armFallbackTimeout() {
    guard revealTask == nil, recoveryView == nil else { return }
    let duration = fallbackDuration
    revealTask = Task { [weak self] in
      try? await Task.sleep(for: duration, clock: .continuous)
      guard !Task.isCancelled, let self else { return }
      self.revealTask = nil
      guard self.windowVisible else { return }
      if self.dragRegionsReady {
        self.revealPage()
      } else {
        self.presentRecovery(reason: .timeout)
      }
    }
  }

  private func presentRecovery(reason: WindowRecoveryView.Reason) {
    revealTask?.cancel()
    revealTask = nil
    revealing = false
    // CRITICAL: fully stop and unmount `WindowLoadingView` BEFORE mounting `WindowRecoveryView` so
    // `GlassSurface.fill` never double-stacks (`03` §4.3).
    removeLoadingView()

    if let existing = recoveryView {
      existing.updateReason(reason)
      return
    }

    let recovery = WindowRecoveryView(
      frame: view.bounds,
      reason: reason,
      serviceContextProvider: { [weak self] in
        if let override = self?.serviceContextOverride { return override() }
        return self?.defaultServiceContext() ?? WindowRecoveryView.ServiceContext()
      })
    recovery.autoresizingMask = [.width, .height]
    recovery.onRestartService = { [weak self] in
      if let override = self?.onRestartServiceOverride {
        try await override()
      } else {
        try await self?.host?.services.restart()
      }
    }
    recovery.onExportDiagnostics = { [weak self] in
      if let override = self?.onExportDiagnosticsOverride {
        return try await override()
      }
      return try await self?.host?.bridge.shell?.exportDiagnosticsFromNativeUI(
        triggerSurface: .recoveryCard) ?? false
    }
    recovery.onReloadPage = { [weak self] in
      self?.reloadFromRecoveryCard()
    }

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 0
    view.addSubview(recovery)
    CATransaction.commit()
    recoveryView = recovery
  }

  private func reloadFromRecoveryCard() {
    pendingRecoveryReason = nil
    dragRegionsReady = false
    revealing = false
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    removeRecoveryView()
    installLoadingView()
    if windowVisible {
      loadingView?.setActive(true, delayContent: false)
      armFallbackTimeout()
    }
    if let override = onReloadPageOverride {
      override()
    } else {
      host?.reloadFromRecovery()
    }
  }

  private func defaultServiceContext() -> WindowRecoveryView.ServiceContext {
    guard let services = host?.services else { return WindowRecoveryView.ServiceContext() }
    return services.recoveryServiceContext()
  }

  private func scheduleRevealIfPossible() {
    guard loadingView != nil || recoveryView != nil, windowVisible, dragRegionsReady, !revealing,
      let host
    else { return }
    let webView = host.webView
    revealing = true
    revealGeneration &+= 1
    let generation = revealGeneration
    let callDocument = host.document
    let finishFrame: (Bool) -> Void = { [weak self, weak webView] succeeded in
      MainActor.assumeIsolated {
        guard let self, self.loadingView != nil || self.recoveryView != nil,
          self.revealGeneration == generation
        else { return }
        self.revealing = false
        guard self.windowVisible, let host = self.host else { return }
        guard host.webView === webView, host.document == callDocument else {
          self.dragRegionsReady = host.chromeReady
          self.scheduleRevealIfPossible()
          return
        }
        if succeeded, self.dragRegionsReady {
          self.revealPage()
        }
      }
    }
    if let hook = animationFrameHook {
      hook(webView, finishFrame)
      return
    }
    webView.callAsyncJavaScript(
      "await new Promise((resolve) => requestAnimationFrame(() => resolve()))",
      in: nil, in: .page
    ) { result in
      if case .success = result { finishFrame(true) } else { finishFrame(false) }
    }
  }

  private func revealPage() {
    guard loadingView != nil || recoveryView != nil else { return }
    revealing = false
    pendingRecoveryReason = nil
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 1
    removeLoadingView()
    removeRecoveryView()
    CATransaction.commit()
    if let window, window.isKeyWindow, let webView = host?.webView,
      window.firstResponder === window || window.firstResponder == nil
    {
      window.makeFirstResponder(webView)
    }
  }
}
