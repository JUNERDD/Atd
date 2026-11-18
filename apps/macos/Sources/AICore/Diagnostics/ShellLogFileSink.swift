import Darwin
import Foundation
import os

/// Serialized POSIX file sink backing ``ShellLogWriter``.
///
/// Owns `O_CLOEXEC` + `0o600` descriptor creation, `fstat` (`st_nlink == 0`) and `lstat` inode
/// drift self-healing (covering both `unlink` and Finder Move-to-Trash), and `2 MiB × 5` rotation.
final class ShellLogFileSink: Sendable {
  let logFileURL: URL
  let maxFileBytes: Int
  let maxFiles: Int
  private let fdBox = OSAllocatedUnfairLock<Int32>(initialState: -1)

  init(logFileURL: URL, maxFileBytes: Int, maxFiles: Int) {
    self.logFileURL = logFileURL
    self.maxFileBytes = maxFileBytes
    self.maxFiles = maxFiles
  }

  deinit {
    closeDescriptor()
  }

  var activeDescriptorForTesting: Int32 {
    fdBox.withLock { $0 }
  }

  func writeBatch(_ batch: Data) {
    guard !batch.isEmpty else { return }
    let directory = logFileURL.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    guard let fd = prepareDescriptor(incomingBytes: batch.count) else { return }
    batch.withUnsafeBytes { rawBuffer in
      guard let base = rawBuffer.baseAddress else { return }
      var writtenTotal = 0
      while writtenTotal < rawBuffer.count {
        let rc = Darwin.write(fd, base.advanced(by: writtenTotal), rawBuffer.count - writtenTotal)
        if rc > 0 {
          writtenTotal += rc
        } else if rc < 0 && errno == EINTR {
          continue
        } else {
          closeDescriptor()
          break
        }
      }
    }
  }

  func closeDescriptor() {
    let fd = fdBox.withLock { current -> Int32 in
      let old = current
      current = -1
      return old
    }
    if fd >= 0 { _ = Darwin.close(fd) }
  }

  private func prepareDescriptor(incomingBytes: Int) -> Int32? {
    let path = logFileURL.path(percentEncoded: false)
    var currentFd = fdBox.withLock { $0 }

    if currentFd >= 0 {
      var openSt = stat()
      var pathSt = stat()
      let valid =
        fstat(currentFd, &openSt) == 0
        && openSt.st_nlink > 0
        && lstat(path, &pathSt) == 0
        && pathSt.st_ino == openSt.st_ino
      if !valid {
        closeDescriptor()
        currentFd = -1
      } else if Int(openSt.st_size) > 0 && Int(openSt.st_size) + incomingBytes > maxFileBytes {
        rotateFiles()
        currentFd = -1
      }
    } else {
      var pathSt = stat()
      if lstat(path, &pathSt) == 0 && Int(pathSt.st_size) > 0
        && Int(pathSt.st_size) + incomingBytes > maxFileBytes
      {
        rotateFiles()
      }
    }

    if currentFd < 0 {
      let opened = Darwin.open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, mode_t(0o600))
      guard opened >= 0 else { return nil }
      let flags = fcntl(opened, F_GETFD)
      if flags >= 0 && (flags & FD_CLOEXEC) == 0 {
        _ = fcntl(opened, F_SETFD, flags | FD_CLOEXEC)
      }
      fdBox.withLock { $0 = opened }
      currentFd = opened
    }
    return currentFd
  }

  private func rotateFiles() {
    closeDescriptor()
    let fm = FileManager.default
    let dir = logFileURL.deletingLastPathComponent()
    let baseName = logFileURL.deletingPathExtension().lastPathComponent
    let ext = logFileURL.pathExtension
    func archiveURL(_ index: Int) -> URL {
      let name = index == 0 ? "\(baseName).\(ext)" : "\(baseName).\(index).\(ext)"
      return dir.appending(path: name, directoryHint: .notDirectory)
    }
    try? fm.removeItem(at: archiveURL(maxFiles - 1))
    for idx in stride(from: maxFiles - 2, through: 0, by: -1) {
      let src = archiveURL(idx)
      let dst = archiveURL(idx + 1)
      if fm.fileExists(atPath: src.path(percentEncoded: false)) {
        try? fm.removeItem(at: dst)
        try? fm.moveItem(at: src, to: dst)
      }
    }
  }
}
