import AICore
import AppKit

/// The task panel's write buttons follow the person's focus as the island's answer card does
/// (contract: `text.writeOffer`, `text.writeFocused`): the focus of the frontmost app other than
/// Atd, or of the last such app while Atd is frontmost, since a click on the panel activates Atd
/// (``PanelClickActivation``) while a summon leaves the person's app frontmost.
///
/// The last such app is recorded from every activation for as long as the shell runs, so a panel
/// shown while Atd is already frontmost still knows it. The focus itself is followed
/// (``AnswerFocusWatch``) only while the panel shows; its offer reaches the panel's page as a
/// state event on every change, a reloaded page included, and becomes none once the panel hides.
final class PanelFocus {
  private let host: WebViewHost
  /// The last app other than Atd that came forward.
  private var lastApp: NSRunningApplication?
  private var activation: NSObjectProtocol?
  private lazy var watch: AnswerFocusWatch = {
    let watch = AnswerFocusWatch(whileAtdFrontmost: { [weak self] in self?.lastApp })
    watch.onChange = { [weak self] offer in self?.publish(offer) }
    return watch
  }()

  init(host: WebViewHost) {
    self.host = host
    record(NSWorkspace.shared.frontmostApplication?.processIdentifier)
    activation = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      // `Notification` is not Sendable, so only the pid crosses into the main-actor handler.
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { self?.record(pid) }
    }
  }

  isolated deinit {
    if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
  }

  /// The app a focus write goes to: the frontmost one unless it is Atd, else the last other one
  /// while it still runs.
  var app: NSRunningApplication? {
    if let front = NSWorkspace.shared.frontmostApplication, front != NSRunningApplication.current {
      return front
    }
    return lastApp.flatMap { $0.isTerminated ? nil : $0 }
  }

  /// The panel showed or hid: the focus is followed exactly while it shows.
  func panelVisible(_ visible: Bool) {
    if visible { watch.start() } else { watch.stop() }
  }

  private func record(_ pid: pid_t?) {
    guard let pid, pid != getpid(), let app = NSRunningApplication(processIdentifier: pid)
    else { return }
    lastApp = app
  }

  /// The page's offer: none while the focus cannot take text, or in an app without a name to
  /// label the buttons with (the contract's 1...255 UTF-16 units).
  private func publish(_ offer: AnswerWriteOffer?) {
    var name = offer?.app ?? ""
    while name.utf16.count > 255 { name.removeLast() }
    let shown = offer.flatMap { offer in
      name.isEmpty ? nil : TextWriteOfferEvent.Offer(app: name, replaces: offer.replaces)
    }
    host.setState(.textWriteOffer(.init(offer: shown)))
  }
}
