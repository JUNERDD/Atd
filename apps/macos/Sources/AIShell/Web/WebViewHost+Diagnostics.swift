import AICore
import AppKit
import Foundation
import OSLog
import Synchronization
import WebKit

/// WebContent crash-loop circuit breaker, recovery reload, and `1s`-bounded renderer breadcrumb
/// collection (`03-contracts-routes-and-ui.md` §4.2–§4.3).
extension WebViewHost {
  /// Hard wire limit (`128 KiB`) on `window.__atdReadDiagnosticsBreadcrumbsJson()` UTF-8 bytes.
  static let maxBreadcrumbsUTF8Bytes = 131_072

  private static let breadcrumbsScript =
    """
    return typeof window.__atdReadDiagnosticsBreadcrumbsJson === 'function'
      ? window.__atdReadDiagnosticsBreadcrumbsJson()
      : null;
    """

  static func emptyBreadcrumbs(now: Date = Date()) -> RendererBreadcrumbsPayload {
    RendererBreadcrumbsPayload(
      capturedAt: now.formatted(
        .iso8601.year().month().day().time(includingFractionalSeconds: true)),
      droppedCount: 0,
      entries: [])
  }

  /// Rebuilds the web view after its WebContent process died, keeping queued events for the new
  /// page. Three crashes within 60 seconds rebuild; the 4th crash trips the circuit breaker and
  /// immediately invokes ``onCrashLoopExhausted`` so ``WindowLoadingStage`` mounts
  /// ``WindowRecoveryView`` without waiting out the 5-second fallback timer.
  func rebuild() {
    let now = ContinuousClock.now
    crashes = crashes.filter { now - $0 < .seconds(60) } + [now]
    let crashTotal = crashes.count
    recordCrashTelemetry(countInWindow: crashTotal, exhausted: crashTotal > 3)

    guard crashTotal <= 3 else {
      Self.log.fault("The \(self.role.rawValue) page keeps crashing; not rebuilding it again.")
      onCrashLoopExhausted?()
      return
    }
    replaceAndLoadWebView()
  }

  /// Triggered from ``WindowRecoveryView``'s `Reload Page` action: resets the 60s crash counter,
  /// notifies unload so ``WindowLoadingStage`` re-arms cleanly, and mounts a fresh `ShellWebView`.
  func reloadFromRecovery() {
    guard !isClosed else { return }
    crashes.removeAll()
    pageDidUnload()
    replaceAndLoadWebView()
  }

  /// Reads the renderer's bounded breadcrumb ring if the main frame is currently on
  /// `ai-app://renderer`, enforcing a strict `1s` `ContinuousClock` timeout and `<= 131_072` UTF-8
  /// byte cap before decoding through `BridgeCoding`. Any timeout or validation error falls back to
  /// an empty payload so native diagnostic exports never hang on a stalled page.
  func readDiagnosticsBreadcrumbs(timeout: Duration = .seconds(1)) async
    -> RendererBreadcrumbsPayload
  {
    guard !isClosed else { return Self.emptyBreadcrumbs() }
    return await Self.readBreadcrumbs(
      from: webView, verifyRendererOrigin: true, timeout: timeout)
  }

  static func readBreadcrumbs(
    from webView: WKWebView,
    verifyRendererOrigin: Bool = true,
    timeout: Duration = .seconds(1)
  ) async -> RendererBreadcrumbsPayload {
    if verifyRendererOrigin {
      guard RendererOrigin.allowsNavigation(to: webView.url, target: .mainFrame) else {
        return emptyBreadcrumbs()
      }
    }

    let rawJson: String? = await withCheckedContinuation { continuation in
      let latch = BreadcrumbOnceLatch(continuation)
      let timeoutTask = Task {
        try? await Task.sleep(for: timeout, clock: .continuous)
        guard !Task.isCancelled else { return }
        latch.resume(nil)
      }
      webView.callAsyncJavaScript(breadcrumbsScript, in: nil, in: .page) { [weak webView] result in
        _ = webView
        timeoutTask.cancel()
        switch result {
        case .success(let value):
          latch.resume(value as? String)
        case .failure:
          latch.resume(nil)
        }
      }
    }

    guard let rawJson, !rawJson.isEmpty, rawJson.utf8.count <= maxBreadcrumbsUTF8Bytes,
      let decoded = try? JSONDecoder().decode(
        RendererBreadcrumbsPayload.self, from: Data(rawJson.utf8))
    else {
      return emptyBreadcrumbs()
    }
    return decoded
  }

  /// Merges breadcrumb rings from multiple `WebViewHost` windows (for example, the resident
  /// `panelHost` and `settings.host`), deduplicating identical entries, sorting chronologically by
  /// `ts`, and capping to the most recent `128` entries and `<= 131_072` UTF-8 JSON bytes.
  static func mergeBreadcrumbs(
    _ payloads: [RendererBreadcrumbsPayload],
    now: Date = Date()
  ) -> RendererBreadcrumbsPayload {
    guard !payloads.isEmpty else { return emptyBreadcrumbs(now: now) }
    var uniquePayloads: [RendererBreadcrumbsPayload] = []
    uniquePayloads.reserveCapacity(payloads.count)
    for payload in payloads where !uniquePayloads.contains(payload) {
      uniquePayloads.append(payload)
    }

    var dedupedEntries: [RendererBreadcrumbsPayload.Entrie] = []
    var totalDropped = 0
    for payload in uniquePayloads {
      totalDropped += max(0, payload.droppedCount)
      for entry in payload.entries where !dedupedEntries.contains(entry) {
        dedupedEntries.append(entry)
      }
    }

    var sorted = dedupedEntries.sorted { $0.ts < $1.ts }
    if sorted.count > 128 {
      totalDropped += sorted.count - 128
      sorted = Array(sorted.suffix(128))
    }

    let nonEmptyCapturedAt =
      uniquePayloads
      .filter { !$0.entries.isEmpty || $0.droppedCount > 0 }
      .compactMap { $0.capturedAt.isEmpty ? nil : $0.capturedAt }
      .max()
    let capturedAt =
      nonEmptyCapturedAt
      ?? uniquePayloads.compactMap { $0.capturedAt.isEmpty ? nil : $0.capturedAt }.max()
      ?? emptyBreadcrumbs(now: now).capturedAt

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    while true {
      let candidate = RendererBreadcrumbsPayload(
        capturedAt: capturedAt,
        droppedCount: totalDropped,
        entries: sorted)
      if let encoded = try? encoder.encode(candidate), encoded.count <= maxBreadcrumbsUTF8Bytes {
        return candidate
      }
      guard !sorted.isEmpty else {
        return RendererBreadcrumbsPayload(
          capturedAt: capturedAt, droppedCount: totalDropped, entries: [])
      }
      sorted.removeFirst()
      totalDropped += 1
    }
  }

  private func replaceAndLoadWebView() {
    let old = webView
    let wasFirstResponder = old.window?.firstResponder === old
    tearDown(notifyUnload: false)
    let handler = BridgeMessageHandler(bridge: bridge)
    let replacement = Self.makeWebView(role: role, services: services, handler: handler)
    handler.host = self
    webView = replacement
    install(replacement)
    if wasFirstResponder { replacement.window?.makeFirstResponder(replacement) }
    load()
  }

  private func recordCrashTelemetry(countInWindow: Int, exhausted: Bool) {
    var entry = RelayAndSupervisorEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.subsystem = 2
    entry.eventKind = exhausted ? 2 : 1
    entry.outcome = exhausted ? 3 : 2
    entry.crashCount = UInt16(clamping: countInWindow)
    let tag =
      exhausted
      ? "webcontent_crash_exhausted:\(role.rawValue)"
      : "webcontent_terminated:\(role.rawValue)"
    entry.detail = InlineText64(truncatingUTF8: tag)
    services.decisionRings.relaySupervisor.append(entry)
    services.shellLog.enqueue(
      level: exhausted ? .fault : .error,
      category: "web",
      message: "\(tag) (count=\(countInWindow))")
  }
}

private nonisolated final class BreadcrumbOnceLatch: Sendable {
  private struct State {
    var continuation: CheckedContinuation<String?, Never>?
  }

  private let state: Mutex<State>

  init(_ continuation: CheckedContinuation<String?, Never>) {
    self.state = Mutex(State(continuation: continuation))
  }

  func resume(_ value: String?) {
    let cont = state.withLock { state -> CheckedContinuation<String?, Never>? in
      let current = state.continuation
      state.continuation = nil
      return current
    }
    cont?.resume(returning: value)
  }
}
