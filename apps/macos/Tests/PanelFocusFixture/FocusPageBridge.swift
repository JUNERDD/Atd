import AICore
import AppKit
import WebKit

/// The product's real outbox and generated delivery script, with the same next-main-queue flush
/// and completion serialization as WebViewHost. Window key delegates only send state; no focus
/// call, event rescue, reload or retry assists the synthetic document.
@MainActor
final class FocusPageBridge: NSObject, NSWindowDelegate, WKNavigationDelegate {
  private let webView: WKWebView
  private var outbox = BridgeOutbox()
  private var valid = true
  private(set) var terminations = 0
  private(set) var deliveryFailures = 0

  init(webView: WKWebView) {
    self.webView = webView
    super.init()
    webView.navigationDelegate = self
  }

  func close() {
    valid = false
    webView.navigationDelegate = nil
    outbox.pageDidUnload()
  }

  func windowDidBecomeKey(_ notification: Notification) { send(true) }
  func windowDidResignKey(_ notification: Notification) { send(false) }

  private func send(_ active: Bool) {
    act(outbox.setState(.windowActive(.init(active: active))))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    act(outbox.pageDidBecomeReady())
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    terminations += 1
    outbox.pageDidUnload()
    FileHandle.standardError.write(
      Data("fixture WebContent terminated count=\(terminations)\n".utf8))
  }

  private func act(_ action: BridgeOutbox.Action) {
    guard valid, action == .flush else { return }
    DispatchQueue.main.async { MainActor.assumeIsolated { self.flush() } }
  }

  private func flush() {
    guard valid, let message = outbox.next() else { return }
    do {
      let argument = try JSONSerialization.jsonObject(with: JSONEncoder().encode(message))
      webView.callAsyncJavaScript(
        NativeBridgeContract.deliverScript,
        arguments: [NativeBridgeContract.deliverArgument: argument], in: nil, in: .page
      ) { [weak self] result in
        MainActor.assumeIsolated {
          guard let self, self.valid else { return }
          let delivered: Bool
          switch result {
          case .success: delivered = true
          case .failure:
            self.deliveryFailures += 1
            delivered = false
            FileHandle.standardError.write(Data("fixture bridge delivery failed\n".utf8))
          }
          self.act(self.outbox.completed(delivered: delivered))
        }
      }
    } catch {
      deliveryFailures += 1
      act(outbox.completed(delivered: false))
    }
  }
}
