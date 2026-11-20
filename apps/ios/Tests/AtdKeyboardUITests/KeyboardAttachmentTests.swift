import Testing
import UIKit

@testable import AtdKeyboardUI

@MainActor
@Suite struct KeyboardAttachmentTests {
  @Test func keyboardCanLoadBeforeTheHostAttachesItsTextField() throws {
    let controller = AtdKeyboardViewController()
    controller.loadViewIfNeeded()
    let root = try #require(controller.view)
    let width: CGFloat = 402
    let size = root.systemLayoutSizeFitting(
      CGSize(width: width, height: 0), withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel)
    #expect(size.width == width)
    #expect(size.height == KeyboardMetrics.height(asking: false))
  }
}
