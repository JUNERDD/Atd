import CoreGraphics
import Foundation

// The long screenshot's shared types: the capture session (AIShell/Capture) enters it from a
// screenshot selection over scrolling content, the engine (AICore/AIShell `LongScreenshot`)
// stitches frames while the user or Atd scrolls, and the island's result card shows what was
// captured and hands it on through its orchestrator.

/// A scroll area under a screenshot selection, as Accessibility reports it.
public struct LongScreenshotScrollArea: Equatable, Sendable {
  /// Its visible frame in Quartz points.
  public let frame: CGRect
  /// Its vertical scroll bar's value, 0 at the top and 1 at the end, when the app exposes one.
  public let verticalValue: Double?

  public init(frame: CGRect, verticalValue: Double?) {
    self.frame = frame
    self.verticalValue = verticalValue
  }
}

/// Whether a screenshot selection offers the long screenshot, and why not.
public enum LongScreenshotAvailability: Equatable, Sendable {
  /// Offered: a scroll area lies under the selection, or Accessibility is off so nothing can say
  /// it does not (scrolling by hand needs no permission).
  case available
  /// Not yet known: the probe for this selection is still running.
  case checking
  /// Not offered: nothing under the selection scrolls.
  case notScrollable
  /// Not offered: the selection spans more than one display.
  case spansDisplays
}

public enum LongScreenshotDirection: Equatable, Sendable {
  case up, down
}

/// The scroll area's part below the selection once the image holds the page's end: the image
/// ends where the selection does unless the user adds it.
public enum LongScreenshotTail: Equatable, Sendable {
  /// Nothing to add: the page's end is not in the image, or nothing of the scroll area lies
  /// below the selection.
  case none
  /// It can be added and is not.
  case excluded
  case included
}

/// The live phase as the control bar, the status row, the preview strip and the size label show
/// it. The engine publishes a new value on the main actor whenever one of these changes.
public struct LongScreenshotProgress: Equatable, Sendable {
  /// The stitched image's height in points.
  public var height: CGFloat
  /// Screens captured: `height` over one screen, the scroll area's visible height (the
  /// selection's when no scroll area is known).
  public var screens: Double
  /// Set while the newest frame no longer overlaps the stitched image on that side: stitching
  /// waits, without a gap, until the user scrolls back.
  public var lost: LongScreenshotDirection?
  /// The image holds the page's end. It clears only when the page later grows past that end
  /// (content loaded there after a pause) and the image grows with it, until the new end.
  public var reachedEnd: Bool
  /// The image holds the page's start.
  public var reachedStart: Bool
  /// The image reached the most it can hold (``LongScreenshotExportRules/maxPixels`` once its
  /// width is capped): it grows no further, and auto-scroll stops. Once true it stays true.
  public var reachedLimit: Bool
  /// The part of the image the selection shows now, in image points; nil before the first frame.
  public var view: ClosedRange<CGFloat>?
  /// The page moved since the phase began.
  public var scrolled: Bool
  /// Atd is scrolling the page.
  public var autoScrolling: Bool
  /// The scroll area's part below the selection, offered once the page's end is in the image.
  public var tail: LongScreenshotTail

  public init(
    height: CGFloat, screens: Double, lost: LongScreenshotDirection? = nil,
    reachedEnd: Bool = false, reachedStart: Bool = false, reachedLimit: Bool = false,
    view: ClosedRange<CGFloat>? = nil, scrolled: Bool = false, autoScrolling: Bool = false,
    tail: LongScreenshotTail = .none
  ) {
    self.height = height
    self.screens = screens
    self.lost = lost
    self.reachedEnd = reachedEnd
    self.reachedStart = reachedStart
    self.reachedLimit = reachedLimit
    self.view = view
    self.scrolled = scrolled
    self.autoScrolling = autoScrolling
    self.tail = tail
  }
}

/// What the status row under the control bar says; nil while there is nothing to do, nothing went
/// wrong and the page's end is not in the image.
public enum LongScreenshotMessage: Equatable, Sendable {
  /// Before the page first moves: scroll inside the selection to keep capturing.
  case start
  /// ``LongScreenshotProgress/lost``: scrolled too fast, scroll back a little.
  case lost
  /// The image holds the page's end, with the scroll area's part below the selection to add or
  /// added (`tail`). Stays once said, wherever the page is scrolled afterwards.
  case end(tail: LongScreenshotTail)
  /// Auto-scroll was asked for without the permission to post scroll events.
  case needsPermission
  /// ``LongScreenshotProgress/reachedLimit``: the image is as long as it can be.
  case limit
}

/// The answer to turning auto-scroll on. At the page's end it starts all the same and tries
/// once more, for a page that loaded more since.
public enum LongScreenshotAutoScrollStart: Equatable, Sendable {
  case started
  /// Posting scroll events needs the "control apps" (Accessibility) permission.
  case needsPermission
  /// The image is as long as it can be.
  case atLimit
}

/// A finished long screenshot: the stitched pixels at the display's own resolution, scaled down
/// to at most the export width, and what the result card and Atd need to describe them.
public struct LongScreenshotImage: @unchecked Sendable {
  /// The stitched pixels, origin top-left: the display's own, or scaled down uniformly to
  /// ``LongScreenshotExportRules/maxPixelWidth`` wide when the selection was wider (``scale``
  /// is then reduced alike).
  public let image: CGImage
  /// Pixels per point.
  public let scale: CGFloat
  /// The app and window the selection lay over, when known.
  public let appName: String?
  public let windowTitle: String?
  public let capturedAt: Date
  /// One screen in points: the scroll area's visible height, or the selection's.
  public let screenHeight: CGFloat

  public init(
    image: CGImage, scale: CGFloat, appName: String?, windowTitle: String?, capturedAt: Date,
    screenHeight: CGFloat
  ) {
    self.image = image
    self.scale = scale
    self.appName = appName
    self.windowTitle = windowTitle
    self.capturedAt = capturedAt
    self.screenHeight = screenHeight
  }

  /// The image's size in points.
  public var pointSize: CGSize {
    CGSize(width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
  }
}

/// A recognized line of the long image, its box in image points (origin top-left).
public struct LongScreenshotLine: Equatable, Sendable {
  public let text: String
  public let box: CGRect

  public init(text: String, box: CGRect) {
    self.text = text
    self.box = box
  }
}

/// What the result card shows: the image, its recognized lines and the sensitive parts found in
/// them (boxes in image points).
public struct LongScreenshotCardSource: @unchecked Sendable {
  public let id: String
  public let shot: LongScreenshotImage
  public let lines: [LongScreenshotLine]
  public let sensitive: [SensitiveText.Box]

  public init(
    id: String, shot: LongScreenshotImage, lines: [LongScreenshotLine],
    sensitive: [SensitiveText.Box]
  ) {
    self.id = id
    self.shot = shot
    self.lines = lines
    self.sensitive = sensitive
  }
}

/// The part of the image the card keeps, in image points, and what is drawn on the image. Every
/// footer action and ask acts on it, so each sends the image as the card shows it.
public struct LongScreenshotKept: Equatable, Sendable {
  public let top: CGFloat
  public let bottom: CGFloat
  /// What is on the image, in image points with the origin at the top-left: what the user drew
  /// in the lightbox's annotate mode, the mosaics Cover Sensitive Info adds (decision D7) and the
  /// marks and replacements text commands leave. Over the whole image, so a trim keeps them where
  /// they were and only the part inside the range is sent. Empty until something is added.
  public let annotations: AnnotationDocument

  public init(top: CGFloat, bottom: CGFloat, annotations: AnnotationDocument = AnnotationDocument())
  {
    self.top = top
    self.bottom = bottom
    self.annotations = annotations
  }
}

/// An ask the card sends; its answer comes back by `id`.
public struct LongScreenshotAsk: Equatable, Sendable {
  public let id: String
  public let question: String
  /// What was kept when it was asked, which its files cover.
  public let kept: LongScreenshotKept
  /// A regeneration's: the ask it regenerates, whose page keeps its answer; this one's comes on
  /// a new page after it.
  public let replacing: String?

  public init(id: String, question: String, kept: LongScreenshotKept, replacing: String? = nil) {
    self.id = id
    self.question = question
    self.kept = kept
    self.replacing = replacing
  }
}

/// What the result card asks its orchestrator to perform, through one closure.
public enum LongScreenshotCardEvent: Equatable, Sendable {
  case ask(LongScreenshotAsk)
  /// Stop the ask with this id; the card has already applied its stop rules.
  case stopAnswer(String)
  /// Run this ask again as a new answer page after its `replacing` one, which keeps its answer.
  case regenerate(LongScreenshotAsk)
  /// Hand the task of this ask to the panel.
  case openAnswer(String)
  case copy(LongScreenshotKept)
  case attach(LongScreenshotKept)
  /// The card went: its close button, or Escape with nothing smaller to go back to.
  case close
}

/// The pages Atd reads a tall image as. The service brings every attached image within
/// ``tileEdge`` pixels on its long edge before a model sees it, which would leave a long
/// screenshot's text unreadable; instead it scales a tall image's width within ``tileEdge`` and
/// cuts it into at most ``maxPages`` equal pages, each within ``tileEdge`` pixels tall (scaling
/// further only when more pages would be needed). This is the one Swift statement of that rule;
/// the service's (`apps/agent-service/src/run-attachments.ts`) must give the same pages.
public enum LongScreenshotPages {
  /// The service's ingest edge (`INGEST_IMAGE`).
  public static let tileEdge = 1568
  public static let maxPages = 8
  /// Images at least this many times taller than wide are read as pages.
  public static let minAspect = 2.0

  /// The source pixel rows of each page, top to bottom; one page when the image is not tall.
  public static func rows(pixelWidth: Int, pixelHeight: Int) -> [Range<Int>] {
    guard pixelWidth > 0, pixelHeight > 0 else { return [] }
    guard Double(pixelHeight) >= Double(pixelWidth) * minAspect else { return [0..<pixelHeight] }
    let scale = min(1, Double(tileEdge) / Double(pixelWidth))
    let scaledHeight = Double(pixelHeight) * scale
    let count = min(maxPages, max(1, Int((scaledHeight / Double(tileEdge)).rounded(.up))))
    return (0..<count).map { index in
      (pixelHeight * index / count)..<(pixelHeight * (index + 1) / count)
    }
  }
}
