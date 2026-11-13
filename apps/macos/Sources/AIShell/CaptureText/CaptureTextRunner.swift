import AICore
import AppKit

/// A surface that runs commands on text in its screenshot (the capture editor, the long
/// screenshot's full-screen preview): it hears each of its runs as the run stands.
protocol CaptureTextConsumer: AnyObject {
  /// Run `update.runId` as it stands (`captureText.progress`), or as the shell ended it before or
  /// without the page: `failed` when its files could not be prepared or the page went away,
  /// `stopped` when it was stopped before the page had it. `copied` is set on a `copy` output's
  /// `done`: whether the shell put its text on the clipboard.
  func captureTextProgress(_ update: CaptureTextProgressParams, copied: Bool?)
}

/// Runs commands placed on `screenshotText` while their surface stays open (contract:
/// `captureText.run`, `captureText.progress`, `captureText.action`), as the long screenshot's
/// asks run: the surface writes the screenshot as it shows and its context, the runner imports
/// them as the asks' files are imported and deletes them once the import answered, then the
/// panel's page runs the command as a task it does not show and reports back here, and the runner
/// routes every update to the surface that owns the run. Under a `copy` output the runner puts
/// each newly made version of the answer on the clipboard itself. A run lives here from
/// ``start(_:surface:commandId:arguments:consumer:files:)`` until its surface closes it
/// (``act(_:runId:adjust:arguments:version:)`` with `close`, ``release(_:)``), it is opened in
/// Atd, or the page goes away (``pageDidUnload()``).
final class CaptureTextRunner {
  /// The files one run attaches, written by its surface into a place of their own, and how to
  /// remove them, which the runner does once their import answered.
  struct Files {
    let urls: [URL]
    let delete: () -> Void
  }

  private struct Entry {
    weak var consumer: (any CaptureTextConsumer)?
    /// Where the answer goes, and whether it waits to be applied as the page last said, for the
    /// updates the runner makes itself.
    let output: CommandOutputAction
    var awaitsApply = false
    /// Whether Open in Atd was requested before the page received the run (`preparing != nil`):
    /// once the run delivers, it is immediately handed over to the panel.
    var opened = false
    /// The files being prepared and imported; nil once the page has the run.
    var preparing: Task<Void, Never>?
    /// A retry's files being prepared and imported (``retry(_:run:adjust:files:)``); nil once the
    /// page has the retry, or while none waits.
    var retrying: Task<Void, Never>?
    /// How many versions of a `copy` output's answer there were when the newest went to the
    /// clipboard: only a newly made version goes there, never one paged back to.
    var copiedCount = 0
  }

  private let attachments: AttachmentImporter
  private let panelHost: WebViewHost
  /// Puts a `copy` output's answer on the clipboard; false while another owner holds it.
  private let copy: (String) -> Bool
  private var runs: [String: Entry] = [:]

  init(attachments: AttachmentImporter, panelHost: WebViewHost, copy: @escaping (String) -> Bool) {
    self.attachments = attachments
    self.panelHost = panelHost
    self.copy = copy
  }

  /// Starts `run` of command `commandId` or free-form `question` (with the values its options
  /// menu picked, else the remembered ones) on `surface`, for `consumer`: `files` writes the
  /// screenshot as it shows and its context (nil: they could not be written), which are imported,
  /// then the page gets the run.
  func start(
    _ run: CaptureTextRun, surface: CaptureTextRunEvent.Surface, commandId: String? = nil,
    question: String? = nil, arguments: CommandArguments?, consumer: any CaptureTextConsumer,
    files: @escaping () async -> Files?
  ) {
    let id = run.id
    runs[id] = Entry(consumer: consumer, output: run.output)
    runs[id]?.preparing = Task { [weak self] in
      guard let written = await files() else {
        self?.end(id, .failed, CaptureTextStringKey.failedExport)
        return
      }
      defer { written.delete() }
      guard let importing = self?.beginImport(written.urls, for: id) else { return }
      do {
        // Once the import starts, cancellation must not end its wait and delete its files early.
        let result = try await importing.value
        guard result.failures.isEmpty, !result.imported.isEmpty else {
          self?.end(id, .failed, CaptureTextStringKey.failedExport)
          return
        }
        self?.deliver(
          run.event(
            surface: surface, commandId: commandId, question: question, arguments: arguments,
            files: result.imported.map { FileRef($0.resource) }))
      } catch {
        self?.end(id, .failed, CaptureTextStringKey.failedExport)
      }
    }
  }

  /// The person acted on run `runId`'s card, or ran its command again on the same text (`again`,
  /// with the values its options menu picked as `arguments`) (contract: `captureText.action`).
  /// Before the page has the run, Stop ends it here, Close forgets it, and Open marks the run so
  /// it opens as soon as it delivers; once the page has it, every action goes to the page, and
  /// Close and Open end the shell's part.
  func act(
    _ action: CaptureTextActionEvent.Action, runId: String,
    adjust: CaptureTextActionEvent.Adjust? = nil, arguments: CommandArguments? = nil,
    version: Int? = nil
  ) {
    guard let entry = runs[runId] else { return }
    if let preparing = entry.preparing {
      if action == .open {
        runs[runId]?.opened = true
        return
      }
      guard action == .stop || action == .close else { return }
      preparing.cancel()
      if action == .stop { end(runId, .stopped, nil) } else { runs.removeValue(forKey: runId) }
      return
    }
    if let retrying = entry.retrying {
      // A retry reading the selection anew is on its way: another one waits for it, and Stop,
      // Close or Open drop it.
      switch action {
      case .regenerate, .adjust, .again: return
      case .stop, .close, .open:
        retrying.cancel()
        runs[runId]?.retrying = nil
      case .version: break
      }
    }
    panelHost.send(
      .captureTextAction(
        CaptureTextActionEvent(
          runId: runId, action: action, adjust: adjust, arguments: arguments, version: version,
          reading: nil)),
      scope: .document)
    if action == .close || action == .open { runs.removeValue(forKey: runId) }
  }

  /// A retry on `run`'s card (`regenerate`, or `adjust` with what the card staged) after `run`
  /// took what the person's selection holds now (``CaptureTextRun/rescope(_:scope:bounds:)``): `files`
  /// writes the screenshot as it shows now and its context, which are imported as a run's are,
  /// then the page gets the retry with them and the run's paragraphs (`captureText.action`'s
  /// `reading`), which this version and every one after it read. Where the files cannot be
  /// written or imported, nothing is retried and the shell beeps.
  func retry(
    _ action: CaptureTextActionEvent.Action, run: CaptureTextRun,
    adjust: CaptureTextActionEvent.Adjust? = nil, files: @escaping () async -> Files?
  ) {
    let id = run.id
    guard let entry = runs[id], entry.preparing == nil, entry.retrying == nil else { return }
    runs[id]?.retrying = Task { [weak self] in
      guard let written = await files() else {
        self?.dropRetry(id)
        return
      }
      defer { written.delete() }
      guard let importing = self?.beginImport(written.urls, for: id, retry: true) else { return }
      do {
        let result = try await importing.value
        guard result.failures.isEmpty, !result.imported.isEmpty else {
          self?.dropRetry(id)
          return
        }
        let reading = run.reading(files: result.imported.map { FileRef($0.resource) })
        self?.deliverRetry(
          CaptureTextActionEvent(
            runId: id, action: action, adjust: adjust, arguments: nil, version: nil,
            reading: reading))
      } catch {
        self?.dropRetry(id)
      }
    }
  }

  /// `consumer`'s surface closed: every run it still holds is closed, except `keeping`, a run
  /// whose card's Open in Atd ended the surface, which its owner opens next
  /// (``act(_:runId:adjust:version:)`` with `open`) once the surface is gone.
  func release(_ consumer: any CaptureTextConsumer, keeping: String? = nil) {
    for (id, entry) in runs
    where id != keeping && (entry.consumer == nil || entry.consumer === consumer) {
      act(.close, runId: id)
    }
  }

  /// `captureText.progress` from the panel's page, for the surface that owns the run; an update
  /// for a run no surface holds any more is ignored, as the contract says. A `copy` output's
  /// answer goes to the clipboard once it is done, and then each newly made version (the newest,
  /// shown as it arrives), not a version the card pages back to.
  func receive(_ update: CaptureTextProgressParams) {
    guard var entry = runs[update.runId], entry.preparing == nil else { return }
    entry.awaitsApply = update.awaitsApply
    let count = update.review?.count ?? 1
    let arrived = update.review.map { $0.version == $0.count } ?? true
    let copies =
      update.output == .copy && update.state == .done && !update.text.isEmpty && arrived
      && count > entry.copiedCount
    if copies { entry.copiedCount = count }
    runs[update.runId] = entry
    entry.consumer?.captureTextProgress(update, copied: copies ? copy(update.text) : nil)
  }

  /// The panel's document went away: every run ends as interrupted, keeping what it had.
  func pageDidUnload() {
    let ended = runs
    runs.removeAll()
    for (id, entry) in ended {
      entry.preparing?.cancel()
      entry.retrying?.cancel()
      entry.consumer?.captureTextProgress(
        Self.update(id, entry, .failed, CaptureTextStringKey.failedInterrupted), copied: nil)
    }
  }

  // MARK: Steps

  /// Admits an import only while the run (or its `retry`) is still being prepared: a Stop
  /// meanwhile starts none.
  private func beginImport(_ files: [URL], for id: String, retry: Bool = false)
    -> Task<ResourceImportResponse, any Error>?
  {
    let pending = retry ? runs[id]?.retrying : runs[id]?.preparing
    guard !Task.isCancelled, pending != nil else { return nil }
    return Task { try await attachments.importPaths(files) }
  }

  private func deliverRetry(_ event: CaptureTextActionEvent) {
    guard !Task.isCancelled, runs[event.runId]?.retrying != nil else { return }
    runs[event.runId]?.retrying = nil
    panelHost.send(.captureTextAction(event), scope: .document)
  }

  /// A retry's files could not be written or imported: it goes no further.
  private func dropRetry(_ id: String) {
    guard !Task.isCancelled, runs[id]?.retrying != nil else { return }
    runs[id]?.retrying = nil
    NSSound.beep()
  }

  private func deliver(_ event: CaptureTextRunEvent) {
    guard !Task.isCancelled, runs[event.runId]?.preparing != nil else { return }
    guard panelHost.isPageReady else {
      return end(event.runId, .failed, CaptureTextStringKey.failedInterrupted)
    }
    let opened = runs[event.runId]?.opened ?? false
    runs[event.runId]?.preparing = nil
    panelHost.send(.captureTextRun(event), scope: .document)
    if opened {
      panelHost.send(
        .captureTextAction(
          CaptureTextActionEvent(
            runId: event.runId, action: .open, adjust: nil, arguments: nil, version: nil,
            reading: nil)),
        scope: .document)
      runs.removeValue(forKey: event.runId)
    }
  }

  /// Ends run `id` here, telling its surface with `message`, and forgets it.
  private func end(
    _ id: String, _ state: CaptureTextProgressParams.State, _ message: CaptureTextStringKey?
  ) {
    guard let entry = runs.removeValue(forKey: id) else { return }
    entry.consumer?.captureTextProgress(Self.update(id, entry, state, message), copied: nil)
  }

  /// The update the runner makes itself for run `id` (`entry`): no result, no versions and no
  /// version being made, as the page would end a run that made none.
  private static func update(
    _ id: String, _ entry: Entry, _ state: CaptureTextProgressParams.State,
    _ message: CaptureTextStringKey?
  ) -> CaptureTextProgressParams {
    CaptureTextProgressParams(
      runId: id, state: state, output: entry.output,
      text: message.map { ShellStrings.shared.text($0) } ?? "", result: nil,
      awaitsApply: entry.awaitsApply, review: nil, draft: nil)
  }
}
