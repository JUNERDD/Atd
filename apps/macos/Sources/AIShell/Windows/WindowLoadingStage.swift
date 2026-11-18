import AICore
import AppKit
import QuartzCore
import WebKit

/// Hosts a page window's `WebViewHost` beneath a native `WindowLoadingView` until the visible page
/// publishes its drag-region chrome readiness and commits an animation frame, re-arming
/// automatically if the page unloads (such as during a WebContent crash rebuild).
final class WindowLoadingStage {
  let view = NSView()
  private weak var host: WebViewHost?
  private weak var window: NSWindow?
  private let titleKey: ShellStringKey
  private var loadingView: WindowLoadingView?
  private var windowVisible = false
  private var dragRegionsReady = false
  private var revealing = false
  private var revealGeneration = 0
  private var revealTask: Task<Void, Never>?

  init(host: WebViewHost, window: NSWindow, titleKey: ShellStringKey) {
    self.host = host
    self.window = window
    self.titleKey = titleKey
    view.wantsLayer = true
    host.container.wantsLayer = true
    host.container.alphaValue = 0
    host.container.frame = view.bounds
    host.container.autoresizingMask = [.width, .height]
    view.addSubview(host.container)
    installLoadingView()
    host.onDragRegionsReady = { [weak self] in self?.handleDragRegionsReady() }
    host.onDragRegionsReset = { [weak self] in self?.handleDragRegionsReset() }
  }

  isolated deinit { revealTask?.cancel() }

  func setWindowVisible(_ visible: Bool) {
    guard windowVisible != visible else { return }
    windowVisible = visible
    guard let loadingView else { return }
    if !visible {
      revealGeneration &+= 1
      revealTask?.cancel()
      revealTask = nil
      revealing = false
      loadingView.setActive(false)
      return
    }
    if host?.chromeReady == true { dragRegionsReady = true }
    // When the page already mounted its chrome in the background while hidden, hold the spinner
    // back briefly so a single-frame layer commit swaps straight to content without a flash.
    loadingView.setActive(true, delayContent: dragRegionsReady)
    armFallbackTimeout()
    scheduleRevealIfPossible()
  }

  func stop() {
    windowVisible = false
    dragRegionsReady = false
    revealing = false
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    loadingView?.stop()
    loadingView?.removeFromSuperview()
    loadingView = nil
    host?.onDragRegionsReady = nil
    host?.onDragRegionsReset = nil
  }

  private func installLoadingView() {
    guard loadingView == nil else { return }
    let loading = WindowLoadingView(frame: view.bounds, titleKey: titleKey)
    loading.autoresizingMask = [.width, .height]
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 0
    view.addSubview(loading)
    CATransaction.commit()
    loadingView = loading
  }

  private func handleDragRegionsReady() {
    dragRegionsReady = true
    scheduleRevealIfPossible()
  }

  private func handleDragRegionsReset() {
    dragRegionsReady = false
    revealing = false
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    installLoadingView()
    host?.onDragRegionsReady = { [weak self] in self?.handleDragRegionsReady() }
    if windowVisible {
      loadingView?.setActive(true, delayContent: false)
      armFallbackTimeout()
    }
  }

  private func armFallbackTimeout() {
    guard revealTask == nil else { return }
    revealTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(5))
      guard !Task.isCancelled else { return }
      self?.revealPage()
    }
  }

  private func scheduleRevealIfPossible() {
    guard loadingView != nil, windowVisible, dragRegionsReady, !revealing,
      let host
    else { return }
    let webView = host.webView
    revealing = true
    revealGeneration &+= 1
    let generation = revealGeneration
    let callDocument = host.document
    webView.callAsyncJavaScript(
      "await new Promise((resolve) => requestAnimationFrame(() => resolve()))",
      in: nil, in: .page
    ) { [weak self, weak webView] result in
      MainActor.assumeIsolated {
        guard let self, self.loadingView != nil, self.revealGeneration == generation else { return }
        self.revealing = false
        guard self.windowVisible, let host = self.host else { return }
        guard host.webView === webView, host.document == callDocument else {
          self.dragRegionsReady = host.chromeReady
          self.scheduleRevealIfPossible()
          return
        }
        if case .success = result {
          self.revealPage()
        }
      }
    }
  }

  private func revealPage() {
    guard let loadingView else { return }
    self.loadingView = nil
    revealing = false
    revealGeneration &+= 1
    revealTask?.cancel()
    revealTask = nil
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    host?.container.alphaValue = 1
    loadingView.stop()
    loadingView.removeFromSuperview()
    CATransaction.commit()
    if let window, window.isKeyWindow, let webView = host?.webView,
      window.firstResponder === window || window.firstResponder == nil
    {
      window.makeFirstResponder(webView)
    }
  }
}
