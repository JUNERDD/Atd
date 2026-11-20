import SwiftUI
import UIKit

/// The share extension's root, which `Share/ShareViewController.swift` subclasses as the
/// extension's principal class. It gets only the items the person shared
/// (`extensionContext?.inputItems`) and ends the share by completing the extension request.
///
/// Stub (F0a): a placeholder with a close button that completes the request. WS-B replaces it
/// with the command flow (prototype `share.js`).
open class ShareRootViewController: UIViewController {
  override open func viewDidLoad() {
    super.viewDidLoad()
    let host = UIHostingController(rootView: SharePlaceholder { [weak self] in self?.close() })
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  /// Ends the share and returns to the app that shared.
  public func close() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

private struct SharePlaceholder: View {
  let close: () -> Void

  var body: some View {
    NavigationStack {
      Color(uiColor: .systemBackground)
        .navigationTitle(Text(verbatim: "Atd"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(action: close) {
              Image(systemName: "xmark")
            }
            .accessibilityLabel(Text(String(localized: "share.close", bundle: .module)))
          }
        }
    }
  }
}
