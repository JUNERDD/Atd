import Testing
import UIKit

@testable import AtdModel

/// AtdModel names SF Symbols without drawing them; only UIKit can tell whether the system has
/// one, so this test, not the module, imports it.
@Suite struct SymbolTests {
  @Test(arguments: BuiltinCommands.all().map(\.symbol) + ExpenseCategory.allCases.map(\.symbol))
  func theSymbolExists(_ name: String) {
    #expect(UIImage(systemName: name) != nil, "\(name) is not an SF Symbol on this system")
  }
}
