import Darwin
import Foundation
import os

/// The shell's end of the native host channel (D3): the unix socket every `atd-chrome-host`
/// Chrome starts connects to (``ChromeHostLocations/socket(bundleId:)``). Accepting and the peer
/// check (``ChromeHostPeer``) run off the main actor; an admitted host reaches ``onConnection``
/// on the main actor, a refused one is closed and logged. ``stop()`` stops accepting and removes
/// the socket; connections already handed out stay open until their owners close them.
final class ChromeHostListener {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")

  /// Called on the main actor with each admitted connection; one nobody keeps is closed.
  var onConnection: ((ChromeHostConnection) -> Void)?

  private let socket: URL
  private let hostExecutable: URL?
  private var acceptor: ChromeHostAcceptor?

  /// `hostExecutable` is the embedded host binary (``ChromeHostLocations/hostExecutable(in:)``);
  /// without one the listener still listens but refuses every peer.
  init(socket: URL, hostExecutable: URL?) {
    self.socket = socket
    self.hostExecutable = hostExecutable
  }

  /// Binds and listens, replacing a stale socket file another run left behind. Throws when the
  /// path does not fit a socket address, when another live listener answers on it (the socket is
  /// then left alone), or when a system call fails. Does nothing while already listening.
  func start() throws(ChromeHostError) {
    guard acceptor == nil else { return }
    let expected = hostExecutable.flatMap(ChromeHostPeer.cdhash(ofExecutable:))
    if expected == nil {
      Self.log.error("No signed Chrome host binary in this build; every host will be refused")
    }
    acceptor = try ChromeHostAcceptor.open(
      path: socket.path(percentEncoded: false), expected: expected
    ) { [weak self] socket, pid in
      self?.admit(socket, peerPid: pid)
    }
  }

  func stop() {
    acceptor?.close()
    acceptor = nil
  }

  /// A peer that passed the check. Dropped (its socket closes) once the listener stopped.
  private func admit(_ socket: ChromeHostSocket, peerPid: pid_t) {
    guard acceptor != nil else { return }
    onConnection?(ChromeHostConnection(socket: socket, peerPid: peerPid))
  }
}

/// The listening socket and its accept source, off the main actor. The source's handler accepts
/// every pending connection, checks each peer and posts the admitted ones to the main queue; its
/// cancel handler closes the listening descriptor once no handler runs.
nonisolated final class ChromeHostAcceptor: Sendable {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")

  private let path: String
  private let source: any DispatchSourceRead

  private init(path: String, source: any DispatchSourceRead) {
    self.path = path
    self.source = source
  }

  static func open(
    path: String, expected: Data?,
    admit: @escaping @MainActor @Sendable (ChromeHostSocket, pid_t) -> Void
  ) throws(ChromeHostError) -> ChromeHostAcceptor {
    guard var address = address(path) else {
      throw ChromeHostError(description: "\(path) is too long for a unix socket.")
    }
    try removeStale(path, address: &address)
    let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw failure("A socket could not be opened") }
    _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC)
    guard bind(descriptor, &address) == 0, chmod(path, 0o600) == 0, listen(descriptor, 16) == 0,
      fcntl(descriptor, F_SETFL, fcntl(descriptor, F_GETFL) | O_NONBLOCK) == 0
    else {
      let error = failure("\(path) could not be listened on")
      Darwin.close(descriptor)
      unlink(path)
      throw error
    }
    let queue = DispatchQueue(label: "com.junerdd.ai.chrome-host.accept")
    let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
    source.setEventHandler { acceptPending(descriptor, expected: expected, admit: admit) }
    source.setCancelHandler { Darwin.close(descriptor) }
    source.activate()
    return ChromeHostAcceptor(path: path, source: source)
  }

  /// Stops accepting and removes the socket file.
  func close() {
    source.cancel()
    unlink(path)
  }

  private static func acceptPending(
    _ listener: Int32, expected: Data?,
    admit: @escaping @MainActor @Sendable (ChromeHostSocket, pid_t) -> Void
  ) {
    while true {
      let client = accept(listener, nil, nil)
      guard client >= 0 else {
        if errno == EINTR || errno == ECONNABORTED { continue }
        return  // EWOULDBLOCK: nothing more pending.
      }
      // Accepted sockets inherit the listener's O_NONBLOCK; the connection reads and writes
      // blocking, on threads of its own.
      _ = fcntl(client, F_SETFL, fcntl(client, F_GETFL) & ~O_NONBLOCK)
      _ = fcntl(client, F_SETFD, FD_CLOEXEC)
      var one: Int32 = 1
      _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
      switch ChromeHostPeer.check(client, expected: expected) {
      case .success(let pid):
        let socket = ChromeHostSocket(descriptor: client)
        DispatchQueue.main.async { MainActor.assumeIsolated { admit(socket, pid) } }
      case .failure(let refusal):
        log.error("Refused a Chrome host connection: \(refusal.description, privacy: .public)")
        Darwin.close(client)
      }
    }
  }

  /// Removes what sits at `path` unless it is a socket another listener still answers on.
  private static func removeStale(
    _ path: String, address: inout sockaddr_un
  ) throws(ChromeHostError) {
    var status = stat()
    guard lstat(path, &status) == 0 else { return }
    if status.st_mode & S_IFMT == S_IFSOCK {
      let probe = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
      let answered = probe >= 0 && connect(probe, &address) == 0
      if probe >= 0 { Darwin.close(probe) }
      if answered { throw ChromeHostError(description: "Another listener answers on \(path).") }
    }
    guard unlink(path) == 0 else { throw failure("The stale \(path) could not be removed") }
  }

  /// `sockaddr_un` for `path`, nil when it does not fit `sun_path` with its terminator.
  private static func address(_ path: String) -> sockaddr_un? {
    var address = sockaddr_un()
    guard path.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else { return nil }
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: path.utf8) }
    return address
  }

  private static func bind(_ descriptor: Int32, _ address: inout sockaddr_un) -> Int32 {
    withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
  }

  private static func connect(_ descriptor: Int32, _ address: inout sockaddr_un) -> Int32 {
    withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
  }

  private static func failure(_ what: String, _ code: Int32 = errno) -> ChromeHostError {
    ChromeHostError(description: "\(what): \(String(cString: strerror(code))).")
  }
}
