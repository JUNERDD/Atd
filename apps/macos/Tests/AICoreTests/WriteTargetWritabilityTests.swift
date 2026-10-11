import Testing

@testable import AICore

@Suite("Write target writability")
struct WriteTargetWritabilityTests {
  typealias Rule = WriteTargetWritability

  @Test("Only an element with no editable ancestor that refuses value and selected text is not")
  func readOnly() {
    #expect(
      !Rule.writable(ancestor: .absent, role: nil, value: .notSettable, selectedText: .notSettable))
    #expect(
      !Rule.writable(ancestor: .absent, role: nil, value: .unsupported, selectedText: .notSettable))
    #expect(
      !Rule.writable(ancestor: .absent, role: nil, value: .unsupported, selectedText: .unsupported))
    #expect(
      !Rule.writable(ancestor: .absent, role: nil, value: .notSettable, selectedText: .unsupported))
  }

  @Test("An editable ancestor, a settable attribute or any unanswered question keeps it writable")
  func writable() {
    #expect(
      Rule.writable(ancestor: .present, role: nil, value: .notSettable, selectedText: .notSettable))
    #expect(
      Rule.writable(ancestor: .unknown, role: nil, value: .notSettable, selectedText: .notSettable))
    #expect(
      Rule.writable(ancestor: .absent, role: nil, value: .settable, selectedText: .notSettable))
    #expect(
      Rule.writable(ancestor: .absent, role: nil, value: .notSettable, selectedText: .settable))
    #expect(
      Rule.writable(ancestor: .absent, role: nil, value: .unknown, selectedText: .unsupported))
    #expect(
      Rule.writable(ancestor: .absent, role: nil, value: .unsupported, selectedText: .unknown))
  }

  @Test("A native text role leaves it to the write, whatever its attributes say")
  func textRole() {
    for role in ["AXTextArea", "AXTextField", "AXComboBox"] {
      #expect(
        Rule.writable(
          ancestor: .absent, role: role, value: .notSettable, selectedText: .unsupported))
      #expect(Rule.decided(by: role))
    }
    #expect(
      !Rule.writable(
        ancestor: .absent, role: "AXWebArea", value: .unsupported, selectedText: .unsupported))
    #expect(!Rule.decided(by: "AXStaticText") && !Rule.decided(by: nil as String?))
  }

  @Test("Questions stop at the first answer that leaves the element writable")
  func decided() {
    #expect(Rule.decided(by: Rule.Ancestor.present) && Rule.decided(by: Rule.Ancestor.unknown))
    #expect(!Rule.decided(by: Rule.Ancestor.absent))
    #expect(Rule.decided(by: Rule.Settable.settable) && Rule.decided(by: Rule.Settable.unknown))
    #expect(!Rule.decided(by: Rule.Settable.notSettable))
    #expect(!Rule.decided(by: Rule.Settable.unsupported))
  }
}
