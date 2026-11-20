import UIKit

/// The keyboard extension's controller; the extension target subclasses it as its principal class.
open class AtdKeyboardViewController: UIInputViewController {
  override open func viewDidLoad() {
    super.viewDidLoad()
    let height = view.heightAnchor.constraint(equalToConstant: 266)
    height.priority = .init(999)
    height.isActive = true
  }
}
