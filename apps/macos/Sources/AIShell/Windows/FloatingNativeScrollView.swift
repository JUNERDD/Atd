import AICore
import AppKit
import QuartzCore

/// The AppKit counterpart of ``FloatingScrollEdges``. It masks the clip view only while content
/// continues beyond an edge, keeping the document, selection, wheel and keyboard handling native.
/// Like the SwiftUI owner, edge feedback replaces the system scrollbar and its gutter.
final class FloatingNativeScrollView: NSScrollView {
  private let fade = CAGradientLayer()
  private let separators = FloatingScrollSeparators()
  private var overflow = AnswerOverflow()
  private var observer: NSObjectProtocol?
  private var maskGeneration = 0

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    hasVerticalScroller = false
    hasHorizontalScroller = false
    scrollerStyle = .overlay
    autohidesScrollers = true
    fade.startPoint = CGPoint(x: 0.5, y: 0)
    fade.endPoint = CGPoint(x: 0.5, y: 1)
    addSubview(separators, positioned: .above, relativeTo: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    observer = nil
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil {
      observer = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
        queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.updateEdges() } }
    }
    updateEdges()
  }

  override func layout() {
    super.layout()
    separators.frame = contentView.frame
    updateEdges()
  }

  override func reflectScrolledClipView(_ clipView: NSClipView) {
    super.reflectScrolledClipView(clipView)
    updateEdges()
  }

  private func updateEdges() {
    let previous = overflow
    if let documentView {
      let visible = documentVisibleRect
      let document = documentView.bounds
      let top = documentView.isFlipped ? visible.minY - document.minY : document.maxY - visible.maxY
      overflow = AnswerOverflow(offset: top, content: document.height, container: visible.height)
    } else {
      overflow = AnswerOverflow()
    }
    let workspace = NSWorkspace.shared
    let plain =
      workspace.accessibilityDisplayShouldReduceTransparency
      || workspace.accessibilityDisplayShouldIncreaseContrast
    separators.overflow = plain ? overflow : AnswerOverflow()
    let needsFade = !plain && (overflow.top || overflow.bottom)
    let hasFade = contentView.layer?.mask === fade
    guard needsFade || hasFade else { return }

    contentView.wantsLayer = true
    guard let layer = contentView.layer else { return }
    if needsFade && !hasFade { layer.mask = fade }
    let flipped = layer.isGeometryFlipped
    let first = flipped ? overflow.top : overflow.bottom
    let last = flipped ? overflow.bottom : overflow.top
    let clear = NSColor.clear.cgColor
    let opaque = NSColor.black.cgColor
    let colors = [
      needsFade && first ? clear : opaque, opaque, opaque, needsFade && last ? clear : opaque,
    ]
    let before = fade.presentation()?.colors ?? fade.colors ?? [opaque, opaque, opaque, opaque]
    let height = max(contentView.bounds.height, 1)
    let lengths = overflow.fadeLengths(for: height)
    let firstFraction = (flipped ? lengths.top : lengths.bottom) / height
    let lastFraction = (flipped ? lengths.bottom : lengths.top) / height
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = contentView.bounds
    fade.locations = [0, NSNumber(value: firstFraction), NSNumber(value: 1 - lastFraction), 1]
    fade.colors = colors
    CATransaction.commit()

    if previous != overflow && !plain && !workspace.accessibilityDisplayShouldReduceMotion,
      window != nil
    {
      let animation = CABasicAnimation(keyPath: "colors")
      animation.fromValue = before
      animation.toValue = colors
      animation.duration = 0.12
      animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
      fade.add(animation, forKey: "edges")
    }
    maskGeneration += 1
    guard !needsFade else { return }
    let generation = maskGeneration
    let delay = plain || workspace.accessibilityDisplayShouldReduceMotion ? 0.0 : 0.12
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, self.maskGeneration == generation, self.contentView.layer?.mask === self.fade
      else { return }
      self.contentView.layer?.mask = nil
    }
  }
}

/// Accessibility fallback, drawn over the clip without taking pointer or accessibility events.
private final class FloatingScrollSeparators: NSView {
  var overflow = AnswerOverflow() {
    didSet { if overflow != oldValue { needsDisplay = true } }
  }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) {
    NSColor.separatorColor.setFill()
    let line = 1 / (window?.backingScaleFactor ?? 1)
    if overflow.top { NSRect(x: 0, y: 0, width: bounds.width, height: line).fill() }
    if overflow.bottom {
      NSRect(x: 0, y: bounds.height - line, width: bounds.width, height: line).fill()
    }
  }
}
