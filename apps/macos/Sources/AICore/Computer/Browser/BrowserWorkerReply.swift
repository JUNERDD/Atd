import Foundation

/// The structured result of one browser worker tool call
/// (`apps/agent-service/src/computer/worker/schemas.ts`, playwright-core over CDP), every field
/// the closed tool set can return. `dispatched` is the worker's word on whether anything that can change the page was
/// sent: false means it certainly was not. A failure carries `error` with one of the worker's
/// codes, mapped to the host's by ``hostCode(_:)``.
public struct BrowserWorkerReply: Decodable, Equatable, Sendable {
  public struct Failure: Decodable, Equatable, Sendable {
    public let code: String
    public let message: String
  }

  /// A page target of the browser; `openerId` is the page that opened it (a popup).
  public struct Page: Decodable, Equatable, Sendable {
    public let pageId: String
    public let url: String
    public let title: String
    public let openerId: String?
  }

  /// What `page_focus` reports of one open page: `visible` is the tab a window shows, and
  /// `hasFocus` is `document.hasFocus()`, which Playwright's focus emulation makes true for every
  /// page it drives. A page is in front of the person only when both hold.
  public struct PageFocus: Decodable, Equatable, Sendable {
    public let pageId: String
    public let hasFocus: Bool
    public let visible: Bool

    public var isInFront: Bool { hasFocus && visible }
  }

  /// A browser window's frame as the browser reports it, after the system had its say.
  public struct WindowBounds: Decodable, Equatable, Sendable {
    public let left: Int
    public let top: Int
    public let width: Int
    public let height: Int
  }

  /// A download the worker saved into the call's `downloadDir` and reports for the first time.
  public struct Download: Decodable, Equatable, Sendable {
    public let name: String
    public let path: String
    public let bytes: Int
    public let mime: String?
  }

  public struct Element: Decodable, Equatable, Sendable {
    public let ref: String
    public let role: String
    public let name: String?
    public let value: String?
    public let enabled: Bool
    public let focused: Bool?
  }

  public struct Evidence: Decodable, Equatable, Sendable {
    public let kind: String
    public let summary: String
  }

  public struct Screenshot: Decodable, Equatable, Sendable {
    public let mime: String
    public let base64: String
  }

  public struct PreviewFrame: Decodable, Equatable, Sendable {
    public let sequence: Int
    public let capturedAt: Double
    public let base64: String
  }

  public let previewId: String?
  public let frame: PreviewFrame?
  public let ok: Bool
  public let dispatched: Bool
  /// The page a call acted on or made (`open_page`: the new background tab).
  public let pageId: String?
  public let navigationGeneration: Int?
  public let observationVersion: Int?
  public let error: Failure?
  public let evidence: [Evidence]?
  public let pages: [Page]?
  public let focus: [PageFocus]?
  /// `open_page` with a window: the frame the new window ended up with after it was parked.
  public let parked: WindowBounds?
  /// `restore_windows`: how many parked windows were put back on a display.
  public let moved: Int?
  public let url: String?
  public let title: String?
  public let elements: [Element]?
  public let baselineId: String?
  public let screenshot: Screenshot?
  public let verified: Bool?
  public let satisfied: Bool?
  public let downloads: [Download]?

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    previewId = try container.decodeIfPresent(String.self, forKey: .previewId)
    frame = try container.decodeIfPresent(PreviewFrame.self, forKey: .frame)
    ok = try container.decode(Bool.self, forKey: .ok)
    dispatched = try container.decodeIfPresent(Bool.self, forKey: .dispatched) ?? false
    pageId = try container.decodeIfPresent(String.self, forKey: .pageId)
    navigationGeneration = try container.decodeIfPresent(Int.self, forKey: .navigationGeneration)
    observationVersion = try container.decodeIfPresent(Int.self, forKey: .observationVersion)
    error = try container.decodeIfPresent(Failure.self, forKey: .error)
    evidence = try container.decodeIfPresent([Evidence].self, forKey: .evidence)
    pages = try container.decodeIfPresent([Page].self, forKey: .pages)
    focus = try container.decodeIfPresent([PageFocus].self, forKey: .focus)
    parked = try container.decodeIfPresent(WindowBounds.self, forKey: .parked)
    moved = try container.decodeIfPresent(Int.self, forKey: .moved)
    url = try container.decodeIfPresent(String.self, forKey: .url)
    title = try container.decodeIfPresent(String.self, forKey: .title)
    elements = try container.decodeIfPresent([Element].self, forKey: .elements)
    baselineId = try container.decodeIfPresent(String.self, forKey: .baselineId)
    screenshot = try container.decodeIfPresent(Screenshot.self, forKey: .screenshot)
    verified = try container.decodeIfPresent(Bool.self, forKey: .verified)
    satisfied = try container.decodeIfPresent(Bool.self, forKey: .satisfied)
    // A report the host cannot read never fails the call: the step's outcome stands, and the
    // files stay staged in the run's directory without being imported.
    downloads = try? container.decodeIfPresent([Download].self, forKey: .downloads)
  }

  private enum CodingKeys: String, CodingKey {
    case ok, dispatched, navigationGeneration, observationVersion, error, evidence, pages, url
    case title, elements, baselineId, screenshot, verified, satisfied, downloads, previewId, frame
    case pageId, focus, parked, moved
  }

  /// The worker's evidence as the contract's (worker kinds are a subset of the host's).
  public var evidenceWire: [ComputerEvidenceWire] {
    (evidence ?? []).prefix(ComputerWireLimits.maxEvidence).compactMap { item in
      ComputerEvidenceWire.Kind(rawValue: item.kind).map {
        ComputerEvidenceWire(kind: $0, summary: item.summary)
      }
    }
  }

  /// The observed elements whose refs the contract accepts (the worker's are
  /// `<navigationGeneration>.<backendNodeId>`).
  public var elementsWire: [ObservationElementWire] {
    (elements ?? []).filter { Self.isRefId($0.ref) && !$0.role.isEmpty }.map { element in
      ObservationElementWire(
        ref: element.ref, role: element.role, name: element.name, value: element.value,
        enabled: element.enabled, focused: element.focused)
    }
  }

  /// The PNG the worker captured, as the contract's screenshot.
  public var screenshotWire: ObservationWire.Screenshot? {
    guard let screenshot, screenshot.mime == "image/png", !screenshot.base64.isEmpty,
      screenshot.base64.count <= ComputerWireLimits.maxScreenshotBase64
    else { return nil }
    return ObservationWire.Screenshot(mime: .png, base64: screenshot.base64)
  }

  /// The host code for a worker error code. The worker's `targetChanged` names an element that
  /// is gone or a page that navigated since the observation: the target page itself is still
  /// there, so it is the observation that went stale. A code the host does not know is an
  /// engine failure.
  public static func hostCode(_ code: String) -> ComputerErrorCode {
    switch code {
    case "targetChanged": .staleObservation
    case "staleObservation", "notFound", "ambiguous", "unsupported", "timeout", "cancelled":
      ComputerErrorCode(rawValue: code) ?? .engineFailed
    default: .engineFailed
    }
  }

  private static func isRefId(_ text: String) -> Bool {
    (1...256).contains(text.count)
      && text.unicodeScalars.allSatisfy { scalar in
        scalar.isASCII
          && (CharacterSet.alphanumerics.contains(scalar) || "_.:-".unicodeScalars.contains(scalar))
      }
  }
}
