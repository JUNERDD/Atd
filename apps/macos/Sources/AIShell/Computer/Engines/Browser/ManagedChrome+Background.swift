import AICore
import AppKit
import MCP
import OSLog

/// A run opens the page of a website it was given in the background (plan §7): the managed
/// browser is never activated or brought forward for it. The page is a background tab of the
/// browser that already runs, created through CDP `Target.createTarget` with `background: true`
/// (the worker's `open_page`). A browser that does not run, or runs without a window to hold a
/// tab, gets a background window instead, parked beyond the displays
/// (``openFirstPage(for:running:)``).
extension ManagedChromes {
  /// How long after a page opened Chrome may still become the active app and be noticed.
  static let activationGrace: Duration = .milliseconds(300)
  /// How many refused bindings wait for the person to open their browser.
  private static let refusedOpeningsKept = 8
  static let log = Logger(subsystem: "com.junerdd.ai", category: "computer")

  /// Opens the binding's start page for a run that was given access to it, unless a page of the
  /// binding's page rule is open already (a second tab would make the target ambiguous), and
  /// returns whether opening made Chrome the active app anyway: the access reply reports that as
  /// `accessOpened(activated:)`, and nothing can undo it, since only an activation could. The
  /// profile must exist; openings of one profile run one after another, so two runs that name the
  /// same website never open two tabs.
  func openInBackground(_ browser: TargetBindingWire.Browser) async throws(ComputerFailure) -> Bool
  {
    let previous = openings[browser.profileId]
    let work = Task { () -> Result<Bool, ComputerFailure> in
      await previous?.value
      do throws(ComputerFailure) {
        return .success(try await self.open(browser))
      } catch {
        return .failure(error)
      }
    }
    openings[browser.profileId] = Task { _ = await work.value }
    let activated = try await work.value.get()
    forgetRefusedOpening(bindingId: browser.bindingId)
    return activated
  }

  private func open(_ browser: TargetBindingWire.Browser) async throws(ComputerFailure) -> Bool {
    guard BrowserOrigins.allows(browser.startUrl, origins: browser.allowedOrigins) else {
      throw ComputerFailure(.unsupported, "The start page is outside the approved website.")
    }
    guard applicationURL != nil else {
      throw ComputerFailure(.targetUnavailable, "Google Chrome is not installed.")
    }
    guard profiles.locate(browser.profileId) != nil else {
      throw ComputerFailure(
        .targetUnavailable, "The browser profile of \(browser.label) is missing on this Mac.")
    }
    guard let workers else {
      throw ComputerFailure(.engineFailed, "The browser worker is not available.")
    }
    let watch = ActivationWatch()
    defer { watch.stop() }
    guard let running = await running(browser.profileId) else {
      let first = try await firstPage(for: browser, running: nil)
      return await activated(watch, by: first)
    }
    let pages = try await listPages(workers, running)
    // A page of the binding's rule is already open: nothing is opened, so nothing can activate.
    if pages.contains(where: { Self.isTarget($0, browser) }) { return false }
    guard !pages.isEmpty else {
      let first = try await firstPage(for: browser, running: running)
      return await activated(watch, by: first)
    }
    try await openTab(workers, running, browser)
    return await activated(watch, by: running)
  }

  /// ``openFirstPage(for:running:)``, remembering the binding when the browser would not start,
  /// so the person's "Open browser" can start it on this very profile.
  private func firstPage(for browser: TargetBindingWire.Browser, running: ManagedChromeInstance?)
    async throws(ComputerFailure) -> ManagedChromeInstance
  {
    do throws(ComputerFailure) {
      return try await openFirstPage(for: browser, running: running)
    } catch {
      if error.reason == .openBrowser {
        refusedOpenings.removeAll { $0.bindingId == browser.bindingId }
        refusedOpenings.append(browser)
        refusedOpenings = Array(refusedOpenings.suffix(Self.refusedOpeningsKept))
      }
      throw error
    }
  }

  /// The binding a background opening refused with `openBrowser`, or nil.
  func refusedOpening(bindingId: String) -> TargetBindingWire.Browser? {
    refusedOpenings.first { $0.bindingId == bindingId }
  }

  /// Drops a refused binding once its browser is open (the person's click, or a later opening).
  func forgetRefusedOpening(bindingId: String) {
    refusedOpenings.removeAll { $0.bindingId == bindingId }
  }

  /// Whether `instance` became the active app while its page opened; waits a moment first, since
  /// Chrome may activate itself a little after the page exists.
  private func activated(_ watch: ActivationWatch, by instance: ManagedChromeInstance) async
    -> Bool
  {
    try? await Task.sleep(for: Self.activationGrace)
    let activated = watch.didActivate(instance.pid)
    if activated {
      Self.log.notice("Opening a website in the background made its browser the active app.")
    }
    return activated
  }

  private static func isTarget(
    _ page: BrowserWorkerReply.Page, _ browser: TargetBindingWire.Browser
  )
    -> Bool
  {
    BrowserOrigins.isTarget(
      url: page.url, urlPrefix: browser.urlPrefix, origins: browser.allowedOrigins)
  }

  private func listPages(_ workers: BrowserWorkerPool, _ instance: ManagedChromeInstance)
    async throws(ComputerFailure) -> [BrowserWorkerReply.Page]
  {
    let (reply, _) = try await workers.invoke(
      instance, "list_pages", [:], timeout: .seconds(10), writes: false)
    return try reply.checked("list_pages").pages ?? []
  }

  /// Creates the start page as a background tab. The worker waits for the document to commit,
  /// so the page the host lists next is at its address.
  private func openTab(
    _ workers: BrowserWorkerPool, _ instance: ManagedChromeInstance,
    _ browser: TargetBindingWire.Browser
  ) async throws(ComputerFailure) {
    let (reply, _) = try await workers.invoke(
      instance, "open_page",
      [
        "url": .string(browser.startUrl),
        "allowedOrigins": PlaywrightBrowserEngine.origins(browser),
      ], timeout: .seconds(20), writes: true)
    _ = try reply.checked("open_page")
  }
}

/// Notes the apps that become active while a page opens, so the access reply can say whether
/// opening made one active anyway. The frontmost app before and after counts as well, in case a
/// notification is late.
private final class ActivationWatch {
  private var observer: (any NSObjectProtocol)?
  private var activated: Set<pid_t> = []
  private let frontmostBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier

  init() {
    observer = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { if let pid { self?.activated.insert(pid) } }
    }
  }

  /// Whether `pid` became the active app since the watch began.
  func didActivate(_ pid: pid_t) -> Bool {
    activated.contains(pid)
      || (frontmostBefore != pid
        && NSWorkspace.shared.frontmostApplication?.processIdentifier == pid)
  }

  func stop() {
    guard let observer else { return }
    NSWorkspace.shared.notificationCenter.removeObserver(observer)
    self.observer = nil
  }
}
