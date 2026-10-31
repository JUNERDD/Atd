import AICore
import AppKit
import OSLog
import Sparkle

/// Sparkle's user driver. A scheduled check downloads and prepares the update it finds here,
/// without a window, so the panel can show its progress (``state``) and offer the restart once it
/// is ready, as Sparkle's silent automatic updates did without reporting progress. An update the
/// person asked for (Check for Updates) runs in Sparkle's standard windows, and so does a
/// scheduled one Sparkle would not install silently: an informational or major update, a failed
/// appcast signature, or an install that needs an administrator. Checking for updates while a
/// quiet update is under way moves it into those windows from where it stands.
///
/// ``state`` follows every update session, shown in the standard windows or not, so the panel
/// and the windows offer the same download and the same install.
final class UpdateUserDriver: NSObject, SPUUserDriver {
  /// Where the update stands. Changes once per whole percent while downloading.
  private(set) var state: UpdateStateEvent = .idle(.init())
  /// Runs after ``state`` changes.
  var onChange: (() -> Void)?
  private let standard: SPUStandardUserDriver
  /// Whether the session in progress runs here without windows rather than in ``standard``.
  private var quiet = false
  private var version = ""
  private var expectedLength: UInt64 = 0
  private var receivedLength: UInt64 = 0
  /// Sparkle's cancellation for the download in progress, kept for the standard window.
  private var cancelDownload: (() -> Void)?
  /// Installs the ready update and relaunches. After a quit the quit guard cancelled, it is
  /// Sparkle's retry, which asks the app to quit again.
  private var install: (() -> Void)?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "updates")

  init(standard: SPUStandardUserDriver) {
    self.standard = standard
  }

  func installNow() {
    install?()
  }

  func show(
    _ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void
  ) {
    standard.show(request, reply: reply)
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    quiet = false
    standard.showUserInitiatedUpdateCheck(cancellation: cancellation)
  }

  func showUpdateFound(
    with appcastItem: SUAppcastItem, state: SPUUserUpdateState,
    reply: @escaping (SPUUserUpdateChoice) -> Void
  ) {
    version = appcastItem.displayVersionString
    quiet = !state.userInitiated && Self.installsQuietly(appcastItem)
    guard quiet else {
      standard.showUpdateFound(with: appcastItem, state: state, reply: reply)
      return
    }
    // An update an earlier session left installing is ready already: installing it now
    // relaunches, and a quit installs it either way. Any other downloads and prepares now.
    if state.stage == .installing {
      becomeReady(reply)
    } else {
      reply(.install)
    }
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {
    if !quiet { standard.showUpdateReleaseNotes(with: downloadData) }
  }

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {
    if !quiet { standard.showUpdateReleaseNotesFailedToDownloadWithError(error) }
  }

  func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    standard.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
  }

  func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    guard quiet else {
      standard.showUpdaterError(error, acknowledgement: acknowledgement)
      return
    }
    // Nobody asked for this update, so its failure only reaches the log; the next scheduled
    // check tries again.
    Self.log.error(
      "update \(self.version, privacy: .public) failed: \(error.localizedDescription, privacy: .public)"
    )
    acknowledgement()
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    cancelDownload = cancellation
    expectedLength = 0
    receivedLength = 0
    report(.downloading(.init(version: version, percent: nil)))
    if !quiet { standard.showDownloadInitiated(cancellation: cancellation) }
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    expectedLength = expectedContentLength
    reportDownload()
    if !quiet { standard.showDownloadDidReceiveExpectedContentLength(expectedContentLength) }
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    receivedLength += length
    reportDownload()
    if !quiet { standard.showDownloadDidReceiveData(ofLength: length) }
  }

  func showDownloadDidStartExtractingUpdate() {
    cancelDownload = nil
    report(.preparing(.init(version: version)))
    if !quiet { standard.showDownloadDidStartExtractingUpdate() }
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    if !quiet { standard.showExtractionReceivedProgress(progress) }
  }

  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    becomeReady(reply)
    if !quiet { showReadyInStandard() }
  }

  func showInstallingUpdate(
    withApplicationTerminated applicationTerminated: Bool,
    retryTerminatingApplication: @escaping () -> Void
  ) {
    if !applicationTerminated { install = retryTerminatingApplication }
    if !quiet {
      standard.showInstallingUpdate(
        withApplicationTerminated: applicationTerminated,
        retryTerminatingApplication: retryTerminatingApplication)
    }
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    guard quiet else {
      standard.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement)
      return
    }
    acknowledgement()
  }

  /// The person checked for updates while one is shown or under way.
  func showUpdateInFocus() {
    if quiet { moveToStandard() }
    standard.showUpdateInFocus()
  }

  func dismissUpdateInstallation() {
    if !quiet { standard.dismissUpdateInstallation() }
    quiet = false
    cancelDownload = nil
    install = nil
    report(.idle(.init()))
  }

  // MARK: State

  /// Keeps Sparkle's install reply for both the panel and the standard window. It must run only
  /// once, and only ever with `.install`, the one choice either offers.
  private func becomeReady(_ reply: @escaping (SPUUserUpdateChoice) -> Void) {
    var pending: ((SPUUserUpdateChoice) -> Void)? = reply
    install = {
      pending?(.install)
      pending = nil
    }
    report(.ready(.init(version: version)))
  }

  private func showReadyInStandard() {
    standard.showReady(toInstallAndRelaunch: { [weak self] _ in self?.install?() })
  }

  /// Hands the quiet session to the standard windows, replaying where it stands; they show the
  /// rest of it from here on.
  private func moveToStandard() {
    quiet = false
    switch state {
    case .idle: break
    case .downloading:
      standard.showDownloadInitiated(cancellation: { [weak self] in self?.cancelDownload?() })
      if expectedLength > 0 { standard.showDownloadDidReceiveExpectedContentLength(expectedLength) }
      if receivedLength > 0 { standard.showDownloadDidReceiveData(ofLength: receivedLength) }
    case .preparing: standard.showDownloadDidStartExtractingUpdate()
    case .ready: showReadyInStandard()
    }
  }

  private func reportDownload() {
    // Sparkle warns that the expected length can be missing or wrong, so the share is capped.
    let percent =
      expectedLength > 0 ? Int(min(receivedLength, expectedLength) * 100 / expectedLength) : nil
    report(.downloading(.init(version: version, percent: percent)))
  }

  private func report(_ next: UpdateStateEvent) {
    guard next != state else { return }
    state = next
    onChange?()
  }

  /// Sparkle's rule for what its automatic updates download without asking, plus an app whose
  /// bundle or folder this user cannot write, where installing would ask for an administrator.
  private static func installsQuietly(_ item: SUAppcastItem) -> Bool {
    let bundle = Bundle.main.bundleURL
    let files = FileManager.default
    return !item.isInformationOnlyUpdate && !item.isMajorUpgrade
      && item.signingValidationStatus != .failed
      && files.isWritableFile(atPath: bundle.path)
      && files.isWritableFile(atPath: bundle.deletingLastPathComponent().path)
  }
}
