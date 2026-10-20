import Foundation

/// The computer host's generation (D3 `hostGeneration`): a number that grows with every shell
/// process start that takes the host lock, persisted in `generation.json` beside it, so replies,
/// target refs and journal entries of an earlier host are told apart from the current one's.
enum HostGeneration {
  private struct Stored: Codable {
    let generation: Int
  }

  static func fileURL(in directory: URL) -> URL {
    directory.appending(path: "generation.json")
  }

  /// The last generation a host took; nil before the first or when the file cannot be read.
  static func stored(in directory: URL) -> Int? {
    guard let data = try? Data(contentsOf: fileURL(in: directory)) else { return nil }
    return (try? JSONDecoder().decode(Stored.self, from: data))?.generation
  }

  /// Takes the next generation for the holder of `lock` and persists it before returning. It is
  /// above both the stored one and `floor` (the highest one the journal names), so a lost or
  /// unreadable file never hands out a generation again.
  static func advance(holding lock: ComputerHostLock, above floor: Int)
    throws(ComputerHostFileError) -> Int
  {
    guard lock.isHeld else { throw .lockNotHeld }
    let next = max(stored(in: lock.directory) ?? 0, floor) + 1
    do {
      try JSONEncoder().encode(Stored(generation: next))
        .write(to: fileURL(in: lock.directory), options: .atomic)
    } catch {
      throw .io("The host generation could not be saved.")
    }
    return next
  }
}
