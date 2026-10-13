import AppKit

/// The read hint of a paste (``ClipboardPaste``): each chunk's string is promised on the
/// pasteboard rather than written, and reports when some process asks for it. The target's ⌘V
/// asks, but so may any other process (a clipboard manager, Universal Clipboard where the item is
/// not kept to this Mac), so a read only suggests that the target pasted the chunk. It confirms
/// the single chunk of a field whose caret cannot be followed; wherever the caret can be,
/// ``FieldCaret`` confirms each chunk instead.
final class PasteHandshake {
  private var waiting: (index: Int, continuation: CheckedContinuation<Bool, Never>)?
  private var timer: Task<Void, Never>?
  /// The highest chunk index read so far.
  private var lastRead = -1
  /// The pasteboard item's provider for the chunk on the pasteboard, kept alive until the next
  /// one replaces it.
  private var current: PromisedChunk?

  /// A provider that supplies `chunk` when it is read and then reports chunk `index` read.
  func promise(_ chunk: String, index: Int) -> NSPasteboardItemDataProvider {
    let provider = PromisedChunk(text: chunk, index: index) { [weak self] index in
      Task { @MainActor in self?.chunkRead(index) }
    }
    current = provider
    return provider
  }

  /// Waits until chunk `index` is read: true when it was, false when `limit` passed first.
  func read(_ index: Int, within limit: Duration) async -> Bool {
    if lastRead >= index { return true }
    return await withCheckedContinuation { continuation in
      waiting = (index, continuation)
      timer = Task { [weak self] in
        try? await Task.sleep(for: limit)
        guard !Task.isCancelled else { return }
        self?.finish(index, read: false)
      }
    }
  }

  private func chunkRead(_ index: Int) {
    lastRead = max(lastRead, index)
    finish(index, read: true)
  }

  /// Resumes the wait for chunk `index`, if that is the one waiting. A read that arrives after
  /// its wait timed out finds none.
  private func finish(_ index: Int, read: Bool) {
    guard let waiting, waiting.index == index else { return }
    self.waiting = nil
    timer?.cancel()
    timer = nil
    waiting.continuation.resume(returning: read)
  }
}

/// One chunk's string, promised for `.string`. AppKit may ask for it on any thread; the reader
/// gets the data synchronously, and the report hops to the main actor.
private nonisolated final class PromisedChunk: NSObject, NSPasteboardItemDataProvider, Sendable {
  let text: String
  let index: Int
  let onRead: @Sendable (Int) -> Void

  init(text: String, index: Int, onRead: @escaping @Sendable (Int) -> Void) {
    self.text = text
    self.index = index
    self.onRead = onRead
  }

  func pasteboard(
    _ pasteboard: NSPasteboard?, item: NSPasteboardItem,
    provideDataForType type: NSPasteboard.PasteboardType
  ) {
    item.setString(text, forType: type)
    onRead(index)
  }
}
