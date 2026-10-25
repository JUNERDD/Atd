import Foundation

/// The origin of generative views' documents, mirrored from `packages/agent-contracts/src/views.ts`
/// (`VIEW_SCHEME`, `VIEW_HOST`, `viewDocumentUrl`): `ai-view://view/<taskId>/<callId>` is a
/// `show_ui` call's window document and `ai-view://view/<taskId>/<callId>/widget` its widget's.
/// Renderer pages frame them, the panel's transcript a view's widget and the view's own window its
/// window document; the view scheme handler serves each from the service under
/// ``contentSecurityPolicy``, and the renderer's navigation lock lets subframes load nothing else.
/// A view is never trusted: the bridge refuses its messages, and it has no network.
public enum ViewOrigin {
  public static let scheme = "ai-view"
  public static let host = "view"
  /// The last path segment of a widget document's URL and service route (`WIDGET_SEGMENT`).
  static let widgetSegment = "widget"
  /// The longest call id, in Unicode scalars.
  static let maxCallIdLength = 256

  /// A view document's whole policy; the service sends none. Inline script and style only (the
  /// document carries the kit, the view runtime and the agent's markup inline); images, fonts and
  /// media from `data:` or `blob:`; no network, frames, workers or plugins; no `<base>` and no
  /// form posts; and sandboxed to an opaque origin with scripts and forms, so a document stays
  /// apart from the renderer even in a frame that lacks its own `sandbox` attribute.
  /// `frame-ancestors` names the renderer page, but WebKit does not enforce it for a custom scheme;
  /// ``ViewRequestGate``'s main-document check is what keeps other pages from framing a view.
  public static let contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors \(RelayRequestGate.rendererOrigin)",
    "sandbox allow-scripts allow-forms",
  ].joined(separator: "; ")

  /// The headers of a document the service assembled: HTML under ``contentSecurityPolicy``, never
  /// cached or sniffed.
  public static let documentHeaders = [
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": contentSecurityPolicy,
  ]

  /// The view document a URL names, or nil when it is not exactly `ai-view://view` (no user,
  /// password or port) with a task id and a call id as path segments, each percent-decoded once
  /// and as ``document(taskId:callId:surface:)`` takes them: the window's document, or the
  /// widget's when one more segment follows that is exactly `widget`. The query (`theme`, `lang`)
  /// and the fragment belong to the page and are ignored.
  public static func document(of url: URL?) -> ViewDocument? {
    guard let url, url.scheme?.lowercased() == scheme, url.host(percentEncoded: true) == host,
      url.port == nil, url.user == nil, url.password == nil
    else { return nil }
    let segments = url.path(percentEncoded: true).split(
      separator: "/", omittingEmptySubsequences: false)
    let surface: ViewSurface
    switch segments.count {
    case 3: surface = .window
    case 4 where segments[3] == widgetSegment: surface = .widget
    default: return nil
    }
    guard segments[0].isEmpty, let taskId = segments[1].removingPercentEncoding,
      let callId = segments[2].removingPercentEncoding
    else { return nil }
    return document(taskId: taskId, callId: callId, surface: surface)
  }

  /// The `surface` document of the task `taskId`'s call `callId`, or nil unless the task id is in
  /// the service's identifier alphabet and the call id is 1–256 characters without control
  /// characters and not a dot segment. The shell's own requests for a view (`view.open`) pass the
  /// same check as the URLs pages load.
  public static func document(taskId: String, callId: String, surface: ViewSurface)
    -> ViewDocument?
  {
    guard isTaskId(taskId), isCallId(callId) else { return nil }
    return ViewDocument(taskId: taskId, callId: callId, surface: surface)
  }

  /// The service's `Identifier`: `^[a-zA-Z0-9_-]{1,128}$`.
  private static func isTaskId(_ value: String) -> Bool {
    (1...128).contains(value.utf8.count)
      && value.utf8.allSatisfy { byte in
        switch byte {
        case UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "A")...UInt8(ascii: "Z"),
          UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "_"), UInt8(ascii: "-"):
          true
        default: false
        }
      }
  }

  /// 1–256 characters without control characters. A dot segment (`.`, `..`) is refused too: the
  /// call id travels on as a path segment of the service request, where an HTTP stack may resolve
  /// it into another route, and no tool call is named that way.
  private static func isCallId(_ value: String) -> Bool {
    let scalars = value.unicodeScalars
    return (1...maxCallIdLength).contains(scalars.count) && value != "." && value != ".."
      && !scalars.contains { $0.properties.generalCategory == .control }
  }
}

/// Where a view's document shows (`ViewSurface` in views.ts).
public enum ViewSurface: Sendable {
  /// The whole interactive view, in a window of its own.
  case window
  /// The glance the conversation shows inline: it takes no input, and a click opens the window.
  case widget
}

/// One view document: the `surface` of the `show_ui` call `callId` of the task `taskId`. Outside
/// this module only ``ViewOrigin`` makes one, after checking the ids.
public struct ViewDocument: Hashable, Sendable {
  public let taskId: String
  public let callId: String
  public let surface: ViewSurface

  init(taskId: String, callId: String, surface: ViewSurface = .window) {
    self.taskId = taskId
    self.callId = callId
    self.surface = surface
  }

  /// The service's shell-only route for the assembled document (`viewDocumentPath` in views.ts):
  /// `/v1/tasks/:taskId/views/:callId`, with `/widget` after it for the widget.
  /// ``RelayPath/encodeSegment(_:)`` escapes everything `encodeURIComponent` does and a few more
  /// characters (`!'()*`); the service decodes either spelling to the same ids.
  public var servicePath: String {
    let window =
      "/v1/tasks/\(RelayPath.encodeSegment(taskId))/views/\(RelayPath.encodeSegment(callId))"
    return switch surface {
    case .window: window
    case .widget: "\(window)/\(ViewOrigin.widgetSegment)"
    }
  }
}
