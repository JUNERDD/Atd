import SwiftUI
import UIKit

/// The share extension's root, which `Share/ShareViewController.swift` subclasses as the
/// extension's principal class. It gets only the items the person shared
/// (`extensionContext?.inputItems`), shows the commands for them (prototype `share.js`), and ends
/// the share inside the extension: it cannot open Atd.
open class ShareRootViewController: UIViewController {
  private var session: ShareSession?

  override open func viewDidLoad() {
    super.viewDidLoad()
    let session = ShareSession(
      services: .live(), complete: { [weak self] in self?.close() },
      dismiss: { [weak self] in self?.cancel() })
    self.session = session
    let host = UIHostingController(rootView: ShareRootView(session: session))
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)

    let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    Task { await session.read(items) }
  }

  /// Ends the share as done and returns to the app that shared.
  public func close() {
    extensionContext?.completeRequest(returningItems: nil)
  }

  /// Ends the share as cancelled (the list's ✕).
  public func cancel() {
    extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
  }
}
