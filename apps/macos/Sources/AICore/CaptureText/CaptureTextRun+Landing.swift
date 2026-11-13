import Foundation

// MARK: Landing on the image

extension CaptureTextRun {
  /// Takes `next` as the items shown against `document`. While the answer grows (its first version
  /// streaming, then whole) the pieces standing on the image stay and the rest lands after them in
  /// the same undo step; once another version becomes the one shown (or the previous version had
  /// been taken off `document`), everything the run still has on the image goes as the new version
  /// lands, an undo step of its own (``superseded``). Nothing lands or goes while the answer waits
  /// for review or stays on the card.
  mutating func show(
    _ next: [Item], in document: AnnotationDocument, initialVersion: Bool, versionChanged: Bool
  ) {
    defer { items = next }
    guard !awaitsReview, destination != .card else { return }
    let standing = annotationIDs.allSatisfy { document[$0] != nil }
    if next == items {
      guard (versionChanged || (initialVersion && !applied.isEmpty)) && !standing else { return }
    } else {
      let growing =
        initialVersion
        ? standing
        : allAppliedStand(in: document) && !versionChanged && landings.current == review?.version
      if growing, next.starts(with: items) { return }
    }
    superseded.formUnion(annotationIDs)
    applied = [:]
    redrawn = [:]
    burst = UUID()
  }

  /// Whether every item in ``items`` that draws on the image has been applied and its annotations
  /// stand in `document` (an item that drew nothing still counts as applied).
  func allAppliedStand(in document: AnnotationDocument) -> Bool {
    for index in items.indices where destination.draws(items[index].tool) {
      guard let ids = applied[index], ids.allSatisfy({ document[$0] != nil }) else {
        return false
      }
    }
    return true
  }

  /// Records the version shown as landed once all of it is on the image (not while the image shows
  /// one the page has not caught up with).
  mutating func remember() {
    guard let version = review?.version, following == nil, !awaitsReview, superseded.isEmpty,
      unapplied.isEmpty
    else { return }
    landings.record(version, .init(lead: lead, items: items, applied: applied))
  }

  /// Undo or redo left `present` (annotation ids) on the image: when nothing the run has there is
  /// among them but another version it landed is, the run takes that version's items and
  /// annotations as its own and returns its number, for the card to show (`captureText.action`'s
  /// `version`) without landing it again. Nil otherwise: the run keeps its version, clearing its
  /// current landing when none of its versions is on the image any more so the next version chosen
  /// lands cleanly.
  public mutating func follow(_ present: Set<UUID>) -> Int? {
    guard review != nil, !awaitsReview, superseded.isEmpty,
      annotationIDs.isDisjoint(with: present)
    else { return nil }
    guard let version = landings.version(in: present), let landing = landings[version] else {
      landings.clearCurrent()
      return nil
    }
    lead = landing.lead
    items = landing.items
    applied = landing.applied
    shownVersion = version
    landings.follow(version)
    following = version == review?.version ? nil : version
    return following
  }

  /// The person applied the version under review (the card's Apply): its pieces land now.
  public mutating func accept() {
    guard awaitsApply else { return }
    accepted = true
  }

  /// The items that should be on the image but are not yet, in order: none while the answer
  /// waits for review or the run puts nothing on the image.
  public var unapplied: [Int] {
    guard !awaitsReview else { return [] }
    return items.indices.filter { applied[$0] == nil && destination.draws(items[$0].tool) }
  }

  /// Something waits to land: items not on the image yet, or another version to take off.
  public var needsLanding: Bool { !unapplied.isEmpty || !superseded.isEmpty }

  /// The landing that took ``superseded`` off the image put `produced` there: the annotations
  /// each item drew (none: it drew nothing, which still counts as applied).
  public mutating func landed(_ produced: [(item: Int, ids: [UUID])]) {
    superseded = []
    redrawn = [:]
    for (item, ids) in produced where items.indices.contains(item) { applied[item] = ids }
    remember()
  }

  /// Every annotation the run put on the image.
  public var annotationIDs: Set<UUID> { Set(applied.values.joined()) }

  /// Everything the run put on the image is off it in `document`: its card's Restore, an undo or
  /// the person took it off.
  public func restored(in document: AnnotationDocument) -> Bool {
    let ids = annotationIDs
    return !ids.isEmpty && ids.allSatisfy { document[$0] == nil }
  }

  /// The card's Reapply: the result taken off `document` lands again, as one undo step.
  public mutating func reapply(in document: AnnotationDocument) {
    guard restored(in: document) else { return }
    redrawn = applied
    applied = [:]
    burst = UUID()
  }

  /// Progress through a run that replaces: paragraphs replaced so far, and how many it reads.
  public var replaced: (done: Int, total: Int) {
    (
      items.indices.filter { applied[$0] != nil && items[$0].tool == .replace }.count,
      paragraphs.count
    )
  }

  /// The number each step item shows on the image now, by item index: its badge's place among
  /// the document's steps (numbers continue after the steps drawn before). An item whose badge
  /// was deleted, or that has not landed yet, has none.
  public func stepNumbers(in document: AnnotationDocument) -> [Int: Int] {
    var numbers: [Int: Int] = [:]
    for (item, ids) in applied where items.indices.contains(item) && items[item].tool == .step {
      if let number = ids.lazy.compactMap({ document.stepNumber(of: $0) }).first {
        numbers[item] = number
      }
    }
    return numbers
  }
}
