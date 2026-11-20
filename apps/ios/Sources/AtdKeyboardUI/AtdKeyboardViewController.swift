import AtdKeyboardCore
import AtdModel
import AtdPinyin
import Observation
import UIKit

/// The keyboard extension's controller; the extension target subclasses it as its principal class.
///
/// It forwards keys, strip taps and host events to the `KeyboardSession` and draws what the session
/// says, again whenever an observed part of it changes. Panels and the keyboard's height are its
/// own.
open class AtdKeyboardViewController: UIInputViewController {
  private let board = KeyboardInputView(frame: .zero)
  private let data = KeyboardData()
  private var session: Session?
  private var panel: Panel?
  /// The Full Access line was tapped and shows where to turn it on.
  private var showsPath = false
  private var showsGlobe: Bool?
  private var libraryObserver: DarwinObserver?
  private var watching: Task<Void, Never>?

  private var boardHeight: NSLayoutConstraint?

  override open func viewDidLoad() {
    super.viewDidLoad()
    board.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(board)
    let height = board.heightAnchor.constraint(
      equalToConstant: KeyboardMetrics.height(asking: false))
    NSLayoutConstraint.activate([
      board.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      board.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      board.topAnchor.constraint(equalTo: view.topAnchor),
      board.bottomAnchor.constraint(equalTo: view.bottomAnchor), height,
    ])
    boardHeight = height
    session = Session(
      document: ProxyDocument(self), clipboard: SystemClipboard(), pinyin: data.engine(),
      generator: data.generator, seenChangeCount: data.seenChangeCount)
    wire()
    reload()
    observe()
    watchLibrary()
  }

  override open func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    reload()
    data.reportSeen(fullAccess: hasFullAccess)
  }

  override open func viewWillLayoutSubviews() {
    super.viewWillLayoutSubviews()
    // Whether the globe key is needed is known only once the keyboard is on screen.
    if showsGlobe != needsInputModeSwitchKey {
      showsGlobe = needsInputModeSwitchKey
      board.keys.configure(
        layer: board.keys.keyLayer, globeTarget: needsInputModeSwitchKey ? self : nil)
    }
  }

  override open func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    guard let session else { return }
    data.save(session.pinyin.userDictionary)
    data.seenChangeCount = session.seenChangeCount
  }

  override open func textDidChange(_ textInput: (any UITextInput)?) {
    super.textDidChange(textInput)
    session?.returnNeedsText = textDocumentProxy.enablesReturnKeyAutomatically ?? false
    session?.documentChanged()
  }

  override open func selectionDidChange(_ textInput: (any UITextInput)?) {
    super.selectionDidChange(textInput)
    session?.documentChanged()
  }

  override open func didReceiveMemoryWarning() {
    super.didReceiveMemoryWarning()
    session?.releaseMemory()
  }

  // MARK: Wiring

  private func wire() {
    board.keys.onKey = { [weak self] in self?.key($0) }
    board.strip.onTap = { [weak self] in self?.tap($0) }
    board.strip.onMark = { [weak self] in self?.session?.openAsk() }
    board.strip.onOptions = { [weak self] id in self?.show(.options(id)) }
    board.strip.onBack = { [weak self] in self?.show(nil) }
    board.strip.onEnd = { [weak self] end in self?.end(end) }
    board.askRow.onClose = { [weak self] in self?.session?.closeAsk() }
    board.candidates.onPick = { [weak self] candidate in
      guard let self, let session else { return }
      if case .ask = session.strip { session.pickOnAsk(candidate) } else { session.pick(candidate) }
      show(nil)
    }
    board.clipboard.onPaste = { [weak self] in
      self?.session?.paste()
      self?.show(nil)
    }
    board.clipboard.onInsert = { [weak self] text in
      self?.session?.insert(text)
      self?.show(nil)
    }
    board.options.onChoose = { [weak self] key, value in
      guard let self, case .options(let id) = panel else { return }
      data.setValue(value, for: key, in: id, fullAccess: hasFullAccess)
      reload()
    }
    board.options.onRun = { [weak self] in
      guard let self, case .options(let id) = panel,
        let command = session?.commands.first(where: { $0.id == id })
      else { return }
      show(nil)
      session?.run(command)
    }
  }

  private func key(_ action: KeyAction) {
    guard let session else { return }
    switch action {
    case .character(let text):
      for character in text { session.type(character) }
    case .space: session.space()
    case .delete: session.delete()
    case .enter: session.pressReturn()
    case .shift, .layer, .globe: break
    }
  }

  private func tap(_ tap: StripTap) {
    guard let session else { return }
    switch tap {
    case .openAsk: session.openAsk()
    case .run(let command): session.run(command)
    case .undo: session.undo()
    case .retry: session.retry()
    case .pick(let candidate): session.pick(candidate)
    case .predict(let word): session.pickPrediction(word)
    case .continueText: session.runContinuation()
    case .version(let index): session.select(version: index)
    case .act(let suggestion): session.act(suggestion)
    case .pickOnAsk(let candidate): session.pickOnAsk(candidate)
    case .showFullAccessPath:
      showsPath = true
      render()
    }
  }

  private func end(_ end: StripEnd) {
    switch end {
    case .clipboard: show(panel == .clipboard ? nil : .clipboard)
    case .candidates(let open): show(open ? nil : .candidates)
    case .regenerate: session?.regenerate()
    case .none: break
    }
  }

  private func show(_ panel: Panel?) {
    self.panel = panel
    render()
  }

  // MARK: Drawing

  /// Draws the session, and draws it again after any change to what this read.
  private func observe() {
    withObservationTracking {
      render()
    } onChange: { [weak self] in
      Task { @MainActor in self?.observe() }
    }
  }

  private func render() {
    guard let session else { return }
    let strip = session.strip
    var asking: AskStrip?
    var candidates: [PinyinCandidate] = []
    switch strip {
    case .ask(let ask):
      asking = ask
      candidates = ask.candidates
    case .candidates(let list):
      candidates = list
    default:
      break
    }
    if case .tools = strip {} else { showsPath = false }
    if panel == .candidates, candidates.isEmpty { panel = nil }
    board.showsAsk = asking != nil
    if let asking { board.askRow.render(asking) }
    board.strip.render(
      StripContent(strip, panel: panel, commands: session.commands, showsPath: showsPath))
    board.keys.states = keyStates(session.keys)
    board.panel = panel
    switch panel {
    case .candidates: board.candidates.render(candidates)
    case .clipboard:
      board.clipboard.render(
        canPaste: session.canPaste, history: session.clipboardHistory, phrases: session.phrases)
    case .options(let id):
      if let command = session.commands.first(where: { $0.id == id }) {
        board.options.render(command)
      }
    case nil: break
    }
    boardHeight?.constant = KeyboardMetrics.height(asking: asking != nil)
  }

  private func keyStates(_ roles: KeyRoles) -> KeyStates {
    switch roles.returnKey {
    case .confirm:
      return KeyStates(
        controlsPreview: roles.controlsPreview, returnTitle: KeyboardText.string("key.confirm"),
        returnEnabled: true, returnAccent: true)
    case .generate(let isEnabled):
      return KeyStates(
        controlsPreview: roles.controlsPreview, returnTitle: KeyboardText.string("key.generate"),
        returnEnabled: isEnabled, returnAccent: isEnabled)
    case .host(let isEnabled):
      let type = textDocumentProxy.returnKeyType ?? .default
      return KeyStates(
        controlsPreview: roles.controlsPreview, returnTitle: KeyboardText.returnTitle(type),
        returnEnabled: isEnabled, returnAccent: isEnabled && type != .default)
    }
  }

  // MARK: Shared data

  private func reload() {
    guard let session else { return }
    let shared = data.load(fullAccess: hasFullAccess)
    session.hasFullAccess = hasFullAccess
    session.commands = shared.commands
    session.phrases = shared.phrases
    session.hasModel = shared.hasModel
    session.returnNeedsText = textDocumentProxy.enablesReturnKeyAutomatically ?? false
    session.refresh()
  }

  /// Reloads when the app (or the keyboard in another app) changes a shared file.
  private func watchLibrary() {
    guard hasFullAccess, let group = data.group else { return }
    let observer = DarwinObserver(name: group.changeNotificationName)
    libraryObserver = observer
    watching = Task { [weak self] in
      for await _ in observer.changes {
        guard let self else { return }
        reload()
      }
    }
  }
}
