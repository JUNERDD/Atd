import Foundation

/// One front-end error a user app's page reported (`app.error`), as the shell forwards it to
/// `POST /v1/apps/:appId/diagnostics` (`FrontendDiagnosticSchema`): the page's report, stamped
/// by the shell with the version the window had loaded and the time it arrived.
public struct UserAppDiagnostic: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case error
    case unhandledrejection
    case console
  }

  public let kind: Kind
  public let message: String
  public let stack: String?
  public let version: Int
  /// ISO 8601.
  public let at: String

  public static let maxMessage = 4000
  public static let maxStack = 16000

  /// Cuts the page's text to the schema's limits, so a runaway page cannot fail the batch.
  public init(kind: Kind, message: String, stack: String?, version: Int, at: Date) {
    self.kind = kind
    self.message = String(message.prefix(Self.maxMessage))
    self.stack = stack.map { String($0.prefix(Self.maxStack)) }
    self.version = version
    self.at = at.formatted(.iso8601)
  }

  /// The same report again, whenever it arrived.
  func repeats(_ other: UserAppDiagnostic) -> Bool {
    kind == other.kind && message == other.message && stack == other.stack
      && version == other.version
  }
}

/// Collects an app's reported errors into batches. The page decides how often it reports, so
/// the buffer bounds what reaches the service: identical consecutive reports collapse, at most
/// ``maxPerMinute`` are accepted in any minute and at most ``maxBatch`` wait at once. What is
/// dropped is counted, and the count travels as a final entry of the next batch.
public struct UserAppDiagnosticBuffer: Sendable {
  public static let maxBatch = 20
  public static let maxPerMinute = 60

  private var pending: [UserAppDiagnostic] = []
  private var accepted: [ContinuousClock.Instant] = []
  private var dropped = 0

  public init() {}

  public var isEmpty: Bool { pending.isEmpty && dropped == 0 }

  /// Adds a report; false when it was dropped or collapsed.
  @discardableResult
  public mutating func append(_ entry: UserAppDiagnostic, at now: ContinuousClock.Instant)
    -> Bool
  {
    accepted = accepted.filter { now - $0 < .seconds(60) }
    if let last = pending.last, last.repeats(entry) { return false }
    guard accepted.count < Self.maxPerMinute, pending.count < Self.maxBatch else {
      dropped += 1
      return false
    }
    accepted.append(now)
    pending.append(entry)
    return true
  }

  /// The batch to send now, empty when there is nothing. `version` stamps the note about
  /// dropped reports.
  public mutating func drain(version: Int, at now: Date) -> [UserAppDiagnostic] {
    var batch = pending
    if dropped > 0 {
      batch.append(
        UserAppDiagnostic(
          kind: .console, message: "\(dropped) more errors were not recorded.", stack: nil,
          version: version, at: now))
    }
    pending = []
    dropped = 0
    return batch
  }
}

/// The document-start script of every user app page: it reports uncaught errors, unhandled
/// rejections and `console.error` calls as `app.error` through the app bridge, and posts
/// `app.ready` when the page has loaded (the app-kit SDK does not post it), which shows the
/// window. It keeps its own reference to the handler before any app script runs, so the page
/// cannot intercept it; the page can always post either itself, which only affects its own app.
public enum UserAppErrorCapture {
  public static func script(messageHandler: String) -> String {
    """
    (() => {
      const handler = window.webkit?.messageHandlers?.[\(jsonString(messageHandler))];
      if (!handler) return;
      const text = (value) => {
        if (value instanceof Error) return value.stack || String(value);
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      };
      const post = (method, params) => {
        try {
          handler.postMessage({ type: 'post', method, params }).catch(() => {});
        } catch {}
      };
      window.addEventListener('load', () => post('app.ready', {}), { once: true });
      let sent = 0;
      const report = (kind, message, stack) => {
        if (++sent > 200) return;
        const params = { kind, message: String(message).slice(0, 4000) };
        if (stack) params.stack = String(stack).slice(0, 16000);
        post('app.error', params);
      };
      window.addEventListener('error', (event) => {
        report('error', event.message || 'Script error', event.error?.stack);
      });
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        report('unhandledrejection', reason?.message ?? text(reason), reason?.stack);
      });
      const original = console.error;
      console.error = function (...args) {
        report('console', args.map(text).join(' '));
        return original.apply(this, args);
      };
    })();
    """
  }

  private static func jsonString(_ value: String) -> String {
    // A plain string always encodes.
    String(decoding: try! JSONEncoder().encode(value), as: UTF8.self)
  }
}
