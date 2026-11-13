import CoreGraphics
import Foundation

/// What a text command reads, as its scope chip says it: the picked paragraphs, every paragraph
/// no mosaic touches while none is picked, or the screenshot itself outside text mode. The count
/// is what the run reads.
public struct CaptureTextScope: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case picked, all, screenshot
  }

  public let kind: Kind
  public let count: Int

  public init(kind: Kind, count: Int) {
    self.kind = kind
    self.count = count
  }

  /// The scope as `captureText.run` carries it.
  public var bridge: CaptureTextRunEvent.Scope { kind == .picked ? .picked : .all }
}

/// The paragraphs picked in a screenshot's text, by their index in one ``CaptureTextLayout``, and
/// how the pointer and the keys change them: a click picks only its paragraph, ⌘-click adds or
/// takes back one, ⇧-click picks the run in reading order from the last paragraph clicked
/// (``anchor``), ⌘A picks all, a marquee replaces the picks or (⌘ or ⇧ held) adds to them, and
/// Escape or the scope chip's × clears them. Only `available` paragraphs (no mosaic touches them,
/// ``CaptureTextLayout/available(hiding:)``) can be picked; a mosaic moved over a picked one
/// drops it (``filtered(_:)``).
public struct CaptureTextPicks: Equatable, Sendable {
  /// How a click picks.
  public enum Click: Equatable, Sendable {
    /// Only this paragraph.
    case only
    /// ⌘: this one in or out, the rest kept.
    case toggle
    /// ⇧: every available paragraph from the anchor to this one.
    case extend
  }

  public private(set) var picked: Set<Int> = []
  /// Where a ⇧-click's run starts: the paragraph last clicked or added.
  public private(set) var anchor: Int?

  public init() {}

  public var isEmpty: Bool { picked.isEmpty }

  /// A click on paragraph `index`; nothing for a paragraph that is not available.
  public mutating func click(
    _ index: Int, _ click: Click, in layout: CaptureTextLayout, available: Set<Int>
  ) {
    guard available.contains(index) else { return }
    switch click {
    case .only:
      picked = [index]
      anchor = index
    case .toggle:
      if picked.remove(index) == nil { picked.insert(index) }
      anchor = index
    case .extend:
      guard let anchor, layout.indices.contains(anchor) else {
        return self.click(index, .only, in: layout, available: available)
      }
      picked = Set(layout.range(from: anchor, to: index).filter(available.contains))
    }
  }

  /// ⌘A: every available paragraph.
  public mutating func selectAll(_ available: Set<Int>) {
    picked = available
    anchor = available.min()
  }

  public mutating func clear() {
    picked = []
    anchor = nil
  }

  /// The picks while a marquee touches `hits` (``CaptureTextLayout/paragraphs(touching:)``),
  /// from `base`, the picks as the drag began: the hits alone, or with `adding` (⌘ or ⇧ held)
  /// the base and the hits. Computing from the base keeps a marquee that shrinks back from
  /// dropping what it no longer touches.
  public static func marquee(
    _ hits: [Int], over base: Self, adding: Bool, available: Set<Int>
  ) -> Self {
    var next = adding ? base : Self()
    let touched = hits.filter(available.contains)
    next.picked.formUnion(touched)
    if !adding || next.anchor == nil { next.anchor = touched.min() ?? next.anchor }
    return next
  }

  /// The picks without the paragraphs no longer available (a mosaic moved over them).
  public func filtered(_ available: Set<Int>) -> Self {
    var next = self
    next.picked.formIntersection(available)
    if let anchor, !available.contains(anchor) { next.anchor = nil }
    return next
  }

  /// The same picks in `new`, a fresh reading of the text (the selection moved, or recognition
  /// settled again): each picked paragraph of `old` becomes the paragraph of `new` with the same
  /// text whose box overlaps it most; one without such a match, or not `available`, is dropped.
  public func revalidated(
    from old: CaptureTextLayout, to new: CaptureTextLayout, available: Set<Int>
  ) -> Self {
    func match(_ index: Int) -> Int? {
      guard old.indices.contains(index) else { return nil }
      let paragraph = old[index]
      return new.indices.filter { candidate in
        new[candidate].text == paragraph.text && new[candidate].box.intersects(paragraph.box)
      }
      .max { overlap(new[$0].box, paragraph.box) < overlap(new[$1].box, paragraph.box) }
    }
    var next = Self()
    next.picked = Set(picked.compactMap(match)).intersection(available)
    next.anchor = anchor.flatMap(match).flatMap { available.contains($0) ? $0 : nil }
    return next
  }

  /// The paragraphs a run reads now, in reading order: the picked ones, or every one of
  /// `available` while none is picked.
  public func reading(available: [Int]) -> [Int] {
    picked.isEmpty ? available : picked.sorted()
  }

  /// The scope chip's data for the picks, `available` being every paragraph no mosaic touches.
  public func scope(available: [Int]) -> CaptureTextScope {
    picked.isEmpty
      ? CaptureTextScope(kind: .all, count: available.count)
      : CaptureTextScope(kind: .picked, count: picked.count)
  }

  private func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat { a.intersection(b).area }
}
