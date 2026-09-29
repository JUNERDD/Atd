import AICore
import Foundation
import WebKit

/// Delivers virtual-socket frames into one web view with at most one `callAsyncJavaScript` in
/// flight (``FrameDeliveryQueue``, spike S6). The call runs in the page world, where the page's
/// stream bridge defines ``SocketBridgeContract/deliveryFunctionBody``.
@MainActor
final class WebViewFrameDelivery {
  private weak var webView: WKWebView?
  private var queue: FrameDeliveryQueue<VirtualSocketFrame>
  private let contentWorld: WKContentWorld

  init(
    webView: WKWebView, contentWorld: WKContentWorld = .page,
    batchByteLimit: Int = FrameDeliveryQueue<VirtualSocketFrame>.defaultBatchByteLimit
  ) {
    self.webView = webView
    self.contentWorld = contentWorld
    queue = FrameDeliveryQueue(batchByteLimit: batchByteLimit)
  }

  func deliver(_ frame: VirtualSocketFrame) {
    guard queue.enqueue(frame, bytes: frame.byteCost) == .flush else { return }
    // The next main-queue turn, so frames arriving in this one share the call.
    DispatchQueue.main.async {
      MainActor.assumeIsolated { self.flush() }
    }
  }

  /// Drops frames the current document has not received yet (it is being replaced).
  func discardPending() {
    queue.discardPending()
  }

  private func flush() {
    let batch = queue.takeBatch()
    guard !batch.isEmpty else { return }
    guard let webView else {
      queue.discardPending()
      _ = queue.completed()
      return
    }
    webView.callAsyncJavaScript(
      SocketBridgeContract.deliveryFunctionBody,
      arguments: [SocketBridgeContract.batchArgument: batch.map { $0.bridgeObject() }],
      in: nil, in: contentWorld
    ) { result in
      MainActor.assumeIsolated {
        if case .failure(let error) = result {
          RelayLog.sockets.error("Frame delivery failed: \(error.localizedDescription)")
        }
        if self.queue.completed() == .flush { self.flush() }
      }
    }
  }
}
