import AtdMiniApps
import AtdModel
import Foundation
import WebKit

/// What a page reads and changes: a stored app's files, or a draft's copy in memory.
protocol MiniAppPageSource: AnyObject {
  var tint: CommandTint { get }
  /// The page and its manifest; nil when the app's files cannot be read.
  func package() -> MiniAppPackage?
  func snapshot() -> MiniAppJSON?
  /// Performs a change the page asked for; returns what it made, for the page.
  func perform(_ request: MiniAppBridgeRequest) throws -> MiniAppJSON?
}

/// One running page: its `WebPage` in the sandbox, the document it shows and the bridge that
/// answers `window.atd`. The page's sheet owns it while it is open and calls `stop()` when it
/// closes.
@Observable
final class MiniAppPageHost {
  /// Where the page is, which decides what its place on the sheet shows.
  enum Phase: Equatable {
    /// Starting, or loading the document: its placeholder.
    case opening
    /// The document has loaded, so its script has drawn the page.
    case shown
    /// The page's files could not be read.
    case missing
    /// WebKit could not load the document; loading it again may work.
    case failed
  }

  let page: WebPage
  let dialogs = MiniAppDialogQueue()
  private(set) var phase = Phase.opening
  /// Whether the page has been shown since the sheet opened. A later load (after 改一改, 撤销)
  /// keeps it on screen for a moment, so a quick one never flashes the placeholder.
  private(set) var hasShown = false
  /// The first error the page reported since it loaded: 这个小应用出错了 · 修复.
  private(set) var error: String?

  @ObservationIgnored let source: any MiniAppPageSource
  @ObservationIgnored private let url: URL
  @ObservationIgnored private let documents = MiniAppDocuments()
  @ObservationIgnored private let controller = WKUserContentController()
  @ObservationIgnored private let messages = MiniAppMessages()
  @ObservationIgnored private var ledger = false
  @ObservationIgnored private var sent: MiniAppJSON?
  @ObservationIgnored private var limit = MiniAppRateLimit()
  @ObservationIgnored private var started = false
  @ObservationIgnored private var watching: Task<Void, Never>?
  /// Counts loads, so only the latest one's outcome changes `phase`.
  @ObservationIgnored private var loads = 0

  init(source: any MiniAppPageSource, url: URL) {
    self.source = source
    self.url = url
    page = WebPage(
      configuration: MiniAppSandbox.configuration(documents: documents, controller: controller),
      navigationDecider: MiniAppNavigation(document: url),
      dialogPresenter: MiniAppDialogs(queue: dialogs))
    #if DEBUG
      page.isInspectable = true
    #endif
    messages.host = self
  }

  /// Puts the walls up, then loads the page.
  func start() async {
    guard !started else { return }
    started = true
    if let rules = await MiniAppSandbox.rules() { controller.add(rules) }
    controller.addScriptMessageHandler(messages, contentWorld: .page, name: "atd")
    load()
    watch()
  }

  func stop() {
    watching?.cancel()
    watching = nil
    controller.removeAllScriptMessageHandlers()
    page.stopLoading()
    dialogs.answer(false)
  }

  /// Loads the app's current version with its data as it is now: on start, after 改一改 or
  /// 撤销, after the page's process ended, and on 重试.
  func load() {
    loads += 1
    guard let package = source.package(), let snapshot = source.snapshot() else {
      phase = .missing
      return
    }
    phase = .opening
    error = nil
    ledger = package.manifest.schema.ledger
    sent = snapshot
    documents.set(
      MiniAppDocument.html(page: package.page, tint: source.tint, snapshot: snapshot), at: url)
    let attempt = loads
    let navigation = page.load(url)
    Task { [weak self] in
      do {
        for try await event in navigation where event == .finished {
          self?.settle(attempt, as: .shown)
        }
      } catch WebPage.NavigationError.webContentProcessTerminated {
        // `watch()` loads the page again.
      } catch {
        self?.settle(attempt, as: .failed)
      }
    }
  }

  /// Ends the opening of load `attempt`, unless a later load took over.
  private func settle(_ attempt: Int, as outcome: Phase) {
    guard attempt == loads, phase == .opening else { return }
    phase = outcome
    if outcome == .shown { hasShown = true }
  }

  /// Sends the page its data again when something else changed it (a widget button, an
  /// expense logged elsewhere).
  func refresh() {
    guard started, phase != .missing, let snapshot = source.snapshot(), snapshot != sent else {
      return
    }
    sent = snapshot
    Task { [page] in
      _ = try? await page.callJavaScript(
        "window.__atdPush(text)", arguments: ["text": snapshot.jsonString])
    }
  }

  /// Reloads the page when iOS ended its process while Atd was away, or tries again when it had
  /// failed to load. A page still opening is left to finish.
  func revive() async {
    guard started, phase == .shown || phase == .failed else { return }
    let alive = try? await page.callJavaScript("return typeof window.atd === 'object'")
    if (alive as? Bool) != true { load() }
  }

  /// A message the page posted through `window.webkit.messageHandlers.atd`: the reply text the
  /// page's promise resolves with, or the reason it rejects with.
  func receive(_ body: Any) -> (reply: String?, refusal: String?) {
    guard let json = MiniAppJSON(foundation: body) else { return (nil, "the message is not JSON") }
    let request: MiniAppBridgeRequest
    do {
      request = try MiniAppBridgeRequest(json, ledger: ledger)
    } catch {
      return (nil, error.reason)
    }
    switch request {
    case .symbols(let names):
      return (MiniAppSymbols.json(names), nil)
    case .error(let message):
      if error == nil { error = message.isEmpty ? "error" : message }
      return (nil, nil)
    case .change, .logExpense, .removeExpense:
      guard limit.take() else { return (nil, "too many changes at once") }
      do {
        let result = try source.perform(request)
        guard let snapshot = source.snapshot() else {
          return (nil, "the app's data cannot be read")
        }
        sent = snapshot
        var reply: [String: MiniAppJSON] = ["snapshot": snapshot]
        if let result { reply["result"] = result }
        return (MiniAppJSON.object(reply).jsonString, nil)
      } catch let invalid as MiniAppInvalid {
        return (nil, invalid.reason)
      } catch {
        return (nil, "Atd could not save the change")
      }
    }
  }

  /// Whether a message comes from the page's own document in its main frame.
  func accepts(_ message: WKScriptMessage) -> Bool {
    message.frameInfo.isMainFrame && message.world == .page
      && MiniAppSandbox.isDocument(message.frameInfo.request.url, of: url)
  }

  /// Reloads the page if its process ends while it is open.
  private func watch() {
    watching = Task { [weak self, page] in
      do {
        for try await _ in page.navigations {}
      } catch WebPage.NavigationError.webContentProcessTerminated {
        guard !Task.isCancelled else { return }
        self?.load()
        self?.watch()
      } catch {
        // Other navigation errors end only that navigation.
      }
    }
  }
}

/// `window.webkit.messageHandlers.atd`; the content controller keeps it, so it keeps its host
/// weakly.
final class MiniAppMessages: NSObject, WKScriptMessageHandlerWithReply {
  weak var host: MiniAppPageHost?

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) async -> (Any?, String?) {
    guard let host, host.accepts(message) else { return (nil, "refused") }
    let answer = host.receive(message.body)
    return (answer.reply, answer.refusal)
  }
}

/// A stored app: its files in the App Group, changed through the tab's model.
final class StoredMiniAppSource: MiniAppPageSource {
  let model: MiniAppsModel
  let appID: String
  /// The book 记账本 logs expenses into.
  let book: () -> String

  init(model: MiniAppsModel, appID: String, book: @escaping () -> String) {
    self.model = model
    self.appID = appID
    self.book = book
  }

  var tint: CommandTint { model.app(appID)?.tint ?? .blue }

  func package() -> MiniAppPackage? {
    model.app(appID).flatMap(model.store.package)
  }

  func snapshot() -> MiniAppJSON? {
    guard let app = model.app(appID), let manifest = model.store.manifest(app) else { return nil }
    return MiniAppSnapshot.json(
      manifest: manifest, data: model.store.data(appID, schema: manifest.schema),
      ledger: manifest.schema.ledger ? model.store.ledger() : nil)
  }

  func perform(_ request: MiniAppBridgeRequest) throws -> MiniAppJSON? {
    guard let app = model.app(appID), let manifest = model.store.manifest(app) else {
      throw MiniAppInvalid("the app's files cannot be read")
    }
    return try model.perform(request, app: app, manifest: manifest, book: book())
  }
}

/// A new app in its preview: what the person tries there changes this copy, which is saved
/// with the app, and the preview's widget shows it.
@Observable
final class DraftMiniAppSource: MiniAppPageSource {
  private(set) var draft: MiniAppDraft

  init(_ draft: MiniAppDraft) {
    self.draft = draft
  }

  var tint: CommandTint { draft.app.tint }

  func package() -> MiniAppPackage? {
    draft.package
  }

  func snapshot() -> MiniAppJSON? {
    MiniAppSnapshot.json(manifest: draft.package.manifest, data: draft.data, ledger: nil)
  }

  func perform(_ request: MiniAppBridgeRequest) throws -> MiniAppJSON? {
    guard case .change(let operation) = request else {
      throw MiniAppInvalid("this app has no ledger")
    }
    let schema = draft.package.manifest.schema
    let undo = try draft.data.apply(
      [operation], schema: schema, context: MiniAppChangeContext(now: .now))
    if case .insert(let list, _) = operation, case .remove(_, let id)? = undo.first {
      return draft.data.records(list).first { $0.recordID == id }.map(MiniAppJSON.object)
    }
    return nil
  }
}
