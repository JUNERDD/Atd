import AICore
import Foundation

/// The host's own action journal (D4 `HostActionRecord`, plan §6.4): `hostjournal.jsonl` beside
/// the host lock, one ``HostJournalEntry`` per line, appended durably before the host moves an
/// action on (the intent before dispatch, the result before the reply). Only the lock holder
/// opens it. On open it folds the file into a ``HostJournalLedger``, from which the host answers
/// `status` and finds what an earlier generation left unsettled.
///
/// The file stays bounded: past ``maxBytes`` it is rewritten with each unsettled action's latest
/// entry and the latest entries of the ``keptSettled`` most recently settled actions. Unsettled
/// actions are never dropped.
final class HostJournal {
  enum Failure: Error, Equatable {
    case rejected(HostJournalLedger.Rejection)
    case file(ComputerHostFileError)
  }

  static let maxBytes = 1 << 20
  static let keptSettled = 200

  let url: URL
  private(set) var ledger: HostJournalLedger
  private var bytes: Int

  /// Opens the journal of the held `lock`, reading what the file holds. A line that does not
  /// decode (one torn by a crash mid-write) is skipped.
  init(holding lock: ComputerHostLock) throws(ComputerHostFileError) {
    guard lock.isHeld else { throw .lockNotHeld }
    url = lock.directory.appending(path: "hostjournal.jsonl")
    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch CocoaError.fileReadNoSuchFile {
      data = Data()
    } catch {
      throw .io("The host journal could not be read.")
    }
    let decoder = JSONDecoder()
    let entries = data.split(separator: UInt8(ascii: "\n")).compactMap {
      try? decoder.decode(HostJournalEntry.self, from: Data($0))
    }
    ledger = HostJournalLedger(replaying: entries)
    bytes = data.count
  }

  var unsettled: [HostJournalEntry] { ledger.unsettled }

  func entry(for actionId: String) -> HostJournalEntry? { ledger.entry(for: actionId) }

  /// Writes `entry` to the file and syncs it before taking it, so a returned append survives a
  /// crash. Nothing changes when the ledger rejects it (a phase that cannot follow the action's
  /// latest one) or the write fails.
  func append(_ entry: HostJournalEntry) throws(Failure) {
    var next = ledger
    do {
      try next.apply(entry)
    } catch {
      throw .rejected(error)
    }
    var line: Data
    do {
      line = try JSONEncoder().encode(entry)
    } catch {
      throw .file(.io("The host journal entry could not be encoded."))
    }
    line.append(UInt8(ascii: "\n"))
    do {
      if !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
        guard
          FileManager.default.createFile(
            atPath: url.path(percentEncoded: false), contents: nil,
            attributes: [.posixPermissions: 0o600])
        else { throw ComputerHostFileError.io("The host journal could not be created.") }
      }
      let handle = try FileHandle(forWritingTo: url)
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: line)
      try handle.synchronize()
    } catch {
      throw .file(.io("The host journal could not be written."))
    }
    ledger = next
    bytes += line.count
    if bytes > Self.maxBytes { try? compact() }
  }

  /// Rewrites the file with what ``HostJournalLedger/compacted(keepingSettled:)`` keeps, and
  /// forgets the rest.
  func compact() throws(ComputerHostFileError) {
    let kept = ledger.compacted(keepingSettled: Self.keptSettled)
    let encoder = JSONEncoder()
    var data = Data()
    do {
      for entry in kept {
        data.append(try encoder.encode(entry))
        data.append(UInt8(ascii: "\n"))
      }
      try data.write(to: url, options: .atomic)
    } catch {
      throw .io("The host journal could not be compacted.")
    }
    ledger = HostJournalLedger(replaying: kept)
    bytes = data.count
  }
}
