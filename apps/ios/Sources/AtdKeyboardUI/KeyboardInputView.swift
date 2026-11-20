import UIKit

/// The keyboard's root view: the ✦ line when it is open, the strip, and the keys or the panel
/// that takes their place. It has the system keyboard's background and plays input clicks.
final class KeyboardInputView: UIInputView, UIInputViewAudioFeedback {
  let askRow = AskRowView()
  let strip = StripView()
  let keys = KeysView()
  let candidates = CandidatePanel()
  let clipboard = ClipboardPanel()
  let options = OptionsPanel()

  var showsAsk = false {
    didSet { if oldValue != showsAsk { setNeedsLayout() } }
  }

  var panel: Panel? {
    didSet {
      keys.isHidden = panel != nil
      candidates.isHidden = panel != .candidates
      clipboard.isHidden = panel != .clipboard
      if case .options = panel { options.isHidden = false } else { options.isHidden = true }
    }
  }

  var enableInputClicksWhenVisible: Bool { true }

  override init(frame: CGRect, inputViewStyle: UIInputView.Style) {
    super.init(frame: frame, inputViewStyle: inputViewStyle)
    allowsSelfSizing = true
    for view in [askRow, strip, keys, candidates, clipboard, options] as [UIView] {
      addSubview(view)
    }
    candidates.isHidden = true
    clipboard.isHidden = true
    options.isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    let ask = showsAsk ? KeyboardMetrics.askHeight : 0
    askRow.isHidden = !showsAsk
    askRow.frame = CGRect(x: 0, y: 0, width: width, height: KeyboardMetrics.askHeight)
    strip.frame = CGRect(x: 0, y: ask, width: width, height: KeyboardMetrics.stripHeight)
    let top = ask + KeyboardMetrics.stripHeight
    let area = CGRect(x: 0, y: top, width: width, height: max(bounds.height - top, 0))
    for view in [keys, candidates, clipboard, options] as [UIView] { view.frame = area }
  }
}
