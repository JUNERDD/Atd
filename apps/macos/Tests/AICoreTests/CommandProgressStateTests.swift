import Testing

@testable import AICore

@Suite("Command progress HUD")
struct CommandProgressStateTests {
  @Test("A show for another target replaces the capsule; a hide for another target leaves it")
  func oneCapsule() {
    var state = CommandProgressState()
    state.show(target: "a", phase: .working(command: "Fix"))
    state.show(target: "b", phase: .working(command: "Shorten"))
    #expect(state.shown?.target == "b")
    let otherHidden = state.hide(target: "a")
    #expect(!otherHidden)
    #expect(state.shown?.target == "b")
    let hidden = state.hide(target: "b")
    #expect(hidden)
    #expect(state.shown == nil)
  }

  @Test("Escape belongs to the capsule only while a run is working")
  func escape() {
    var state = CommandProgressState()
    #expect(!state.cancelsWithEscape)
    state.show(target: "a", phase: .working(command: "Fix"))
    #expect(state.cancelsWithEscape)
    state.show(target: "a", phase: .notice(message: "Copied instead."))
    #expect(!state.cancelsWithEscape)
  }

  @Test("Cancel acts only while working, Open only on a notice, and either takes it away")
  func presses() {
    var state = CommandProgressState()
    state.show(target: "a", phase: .working(command: "Fix"))
    let openWhileWorking = state.press(.open)
    #expect(openWhileWorking == nil)
    let cancel = state.press(.cancel)
    #expect(
      cancel
        == CommandProgressActionEvent(target: "a", action: .cancel, arguments: nil, compose: nil))
    #expect(state.shown == nil)
    state.show(target: "b", phase: .notice(message: "Failed."))
    let cancelOnNotice = state.press(.cancel)
    #expect(cancelOnNotice == nil)
    let open = state.press(.open)
    #expect(
      open == CommandProgressActionEvent(target: "b", action: .open, arguments: nil, compose: nil))
    let again = state.press(.open)
    #expect(again == nil)
  }

  @Test("Shown text is trimmed, and blank text shows nothing")
  func phases() {
    let working = CommandProgressShowParams.State.working(.init(command: "  Fix \n", summary: nil))
    #expect(CommandProgressState.phase(working) == .working(command: "Fix"))
    let blank = CommandProgressShowParams.State.notice(.init(message: " \n "))
    #expect(CommandProgressState.phase(blank) == nil)
  }

  static let tone = CommandOption.choice(
    .init(
      key: "tone", label: "Tone", value: "formal",
      options: [.init(value: "casual", label: "Casual"), .init(value: "formal", label: "Formal")]))
  static let short = CommandOption.toggle(.init(key: "short", label: "Short", value: false))
  static let topic = CommandOption.input(.init(key: "topic", label: "Topic"))
  static let output = CommandOutputOption(
    value: .replaceSelection, saved: .replaceSelection, selection: true)
  static let choosing = CommandProgressState.Phase.choose(
    command: "Fix", options: [tone], output: output)

  @Test("A working run keeps its trimmed summary; a choose phase needs options")
  func richPhases() {
    let working = CommandProgressShowParams.State.working(
      .init(command: "Fix", summary: " Formal "))
    #expect(CommandProgressState.phase(working) == .working(command: "Fix", summary: "Formal"))
    let blank = CommandProgressShowParams.State.working(.init(command: "Fix", summary: "  "))
    #expect(CommandProgressState.phase(blank) == .working(command: "Fix", summary: nil))
    let choose = CommandProgressShowParams.State.choose(
      .init(command: " Fix ", options: [Self.tone], output: Self.output))
    #expect(CommandProgressState.phase(choose) == Self.choosing)
    // Where the answer goes is always offered, so a command without parameters has a card too.
    let bare = CommandProgressShowParams.State.choose(
      .init(command: "Fix", options: [], output: Self.output))
    #expect(
      CommandProgressState.phase(bare) == .choose(command: "Fix", options: [], output: Self.output))
    let blankName = CommandProgressShowParams.State.choose(
      .init(command: " ", options: [], output: Self.output))
    #expect(CommandProgressState.phase(blankName) == nil)
  }

  @Test("The shell's writing shows over nothing or its own target's island, never another's")
  func shellWriting() {
    var state = CommandProgressState()
    #expect(state.letsShellShow(for: "a"))
    state.show(target: "b", phase: .working(command: "Fix"))
    #expect(!state.letsShellShow(for: "a") && state.letsShellShow(for: "b"))
    state.show(target: "b", phase: Self.choosing)
    #expect(!state.letsShellShow(for: "a"))
  }

  @Test("Only the cards take the keyboard; Escape stays with them rather than the hot key")
  func choosing() {
    var state = CommandProgressState()
    state.show(target: "a", phase: Self.choosing)
    #expect(state.isChoosing && state.takesKeyboard && !state.cancelsWithEscape)
    state.show(target: "a", phase: .answer(command: "Fix", answer: "Fixed.", note: nil))
    #expect(!state.isChoosing && state.isAnswering && state.takesKeyboard)
    #expect(!state.cancelsWithEscape)
    let others: [CommandProgressState.Phase] = [
      .working(command: "Fix"), .writing, .done, .copied, .notice(message: "No."),
    ]
    for phase in others {
      state.show(target: "a", phase: phase)
      #expect(!state.takesKeyboard && !state.isAnswering)
    }
  }

  @Test("An answer keeps its text as given; a blank command or answer shows nothing")
  func answerPhase() {
    typealias Answer = CommandProgressShowParams.State.Answer
    let answer = CommandProgressShowParams.State.answer(
      Answer(command: " Fix \n", answer: "  Fixed.\n", note: " Not editable. "))
    #expect(
      CommandProgressState.phase(answer)
        == .answer(command: "Fix", answer: "  Fixed.\n", note: "Not editable."))
    let silent = CommandProgressShowParams.State.answer(
      Answer(command: "Fix", answer: "Fixed.", note: " \n "))
    #expect(
      CommandProgressState.phase(silent) == .answer(command: "Fix", answer: "Fixed.", note: nil))
    let blankAnswer = CommandProgressShowParams.State.answer(
      Answer(command: "Fix", answer: " \n\t ", note: nil))
    #expect(CommandProgressState.phase(blankAnswer) == nil)
    let blankCommand = CommandProgressShowParams.State.answer(
      Answer(command: "  ", answer: "Fixed.", note: nil))
    #expect(CommandProgressState.phase(blankCommand) == nil)
  }

  @Test("The answer card opens the run and goes; Cancel and the others do nothing on it")
  func answerPresses() {
    var state = CommandProgressState()
    state.show(target: "a", phase: .answer(command: "Fix", answer: "Fixed.", note: nil))
    #expect(state.answerShown == "Fixed.")
    for action in [CommandProgressActionEvent.Action.cancel, .change, .run, .edit] {
      #expect(state.press(action) == nil)
    }
    #expect(state.press(.open) == .init(target: "a", action: .open, arguments: nil, compose: nil))
    #expect(state.shown == nil && state.answerShown == nil)
    state.show(target: "a", phase: .copied)
    #expect(state.answerShown == nil && state.press(.open) == nil)
  }

  @Test("A shortcut's press replaces an outcome, never a run or its options")
  func pressGivesWay() {
    var state = CommandProgressState()
    #expect(!state.givesWayToPress)
    let outcomes: [CommandProgressState.Phase] = [
      .done, .copied, .notice(message: "No."), .answer(command: "Fix", answer: "Fixed.", note: nil),
    ]
    for phase in outcomes {
      state.show(target: "a", phase: phase)
      #expect(state.givesWayToPress)
    }
    let runs: [CommandProgressState.Phase] = [
      .working(command: "Fix"), Self.choosing, .writing,
    ]
    for phase in runs {
      state.show(target: "a", phase: phase)
      #expect(!state.givesWayToPress)
    }
  }

  @Test("The answer card is as tall as its answer, up to the largest shape, then scrolls")
  func answerCardSize() {
    let chrome = 12 + 28 + 8 + 32.0
    #expect(IslandMetrics.answerCardHeight(note: 0, answer: 36) == chrome + 36)
    #expect(IslandMetrics.answerCardHeight(note: 15, answer: 36) == chrome + 15 + 2 + 36)
    #expect(IslandMetrics.answerCardHeight(note: 0, answer: 36.2) == chrome + 37)
    let tallest = IslandMetrics.maxShape.height
    #expect(IslandMetrics.answerCardHeight(note: 30, answer: 9_000) == tallest)
    #expect(IslandMetrics.answerRoom(note: 0) == tallest - chrome)
    #expect(IslandMetrics.answerRoom(note: 30) == tallest - chrome - 32)
  }

  @Test("Change keeps the run; Run turns the card into the run; Edit and Cancel take it away")
  func cardPresses() {
    var state = CommandProgressState()
    state.show(target: "a", phase: .working(command: "Fix"))
    #expect(state.press(.change) == nil)
    state.show(target: "a", phase: .working(command: "Fix", summary: "Formal"))
    #expect(
      state.press(.change) == .init(target: "a", action: .change, arguments: nil, compose: nil))
    #expect(state.shown?.phase == .working(command: "Fix", summary: "Formal"))
    let values = CommandArguments(output: nil, choices: ["tone": "casual"], toggles: [:])
    state.show(target: "a", phase: Self.choosing)
    #expect(state.press(.run) == nil)
    #expect(
      state.press(.run, arguments: values)
        == .init(target: "a", action: .run, arguments: values, compose: nil))
    #expect(state.shown?.phase == .working(command: "Fix"))
    state.show(target: "a", phase: Self.choosing)
    #expect(
      state.press(.edit, arguments: values)
        == .init(target: "a", action: .edit, arguments: values, compose: nil))
    #expect(state.shown == nil)
    state.show(target: "a", phase: Self.choosing)
    #expect(
      state.press(.cancel) == .init(target: "a", action: .cancel, arguments: nil, compose: nil))
    #expect(state.shown == nil)
  }

  @Test("A single choice is a list: keys move, Return and digits pick and run")
  func list() {
    var card = OptionsCard(options: [Self.tone])
    #expect(card.page == .list && card.selection == 1 && !card.showsFilter)
    #expect(
      card.rows == [
        .value(.init(value: "casual", label: "Casual"), current: false),
        .value(.init(value: "formal", label: "Formal"), current: true),
      ])
    #expect(card.handle(.up) == .handled && card.selection == 0)
    #expect(card.handle(.up) == .handled && card.selection == 0)
    #expect(card.handle(.left) == .ignored)
    #expect(card.handle(.space) == .ignored)
    let casual = CommandArguments(output: nil, choices: ["tone": "casual"], toggles: [:])
    #expect(card.handle(.enter) == .outcome(.run(casual)))
    var digits = OptionsCard(options: [Self.tone])
    #expect(digits.handle(.digit(3)) == .handled)
    #expect(digits.handle(.digit(1)) == .outcome(.run(casual)))
    var button = OptionsCard(options: [Self.tone])
    #expect(
      button.runButton()
        == .run(CommandArguments(output: nil, choices: ["tone": "formal"], toggles: [:])))
    var closing = OptionsCard(options: [Self.tone])
    #expect(closing.handle(.escape) == .outcome(.close))
  }

  @Test("A long list filters without resizing, shows no match, and clears before closing")
  func filter() {
    let values = (1...10).map { CommandOption.Choice.Option(value: "v\($0)", label: "Value \($0)") }
    var card = OptionsCard(
      options: [.choice(.init(key: "k", label: "K", value: "v1", options: values))])
    #expect(card.showsFilter && card.capacity == IslandMetrics.maxVisibleRows)
    card.setFilter("value 1")
    #expect(card.rows.count == 2 && card.selection == 0 && card.capacity == 8)
    card.setFilter("zzz")
    #expect(card.rows == [.noMatch])
    #expect(card.handle(.enter) == .handled)
    #expect(card.handle(.escape) == .handled && card.filter.isEmpty)
    #expect(card.handle(.down) == .handled && card.selection == 1)
    for _ in 0..<9 { _ = card.handle(.down) }
    #expect(card.selection == 9 && card.visible == 2..<10)
    card.scroll(by: -5)
    #expect(card.visible == 0..<8)
  }

  @Test("A sheet changes values in place, drills into a choice, flips toggles, hands inputs off")
  func sheet() {
    var card = OptionsCard(options: [Self.tone, Self.short, Self.topic])
    #expect(card.page == .sheet && card.rows.count == 3)
    #expect(card.handle(.right) == .handled)
    #expect(card.arguments.choices["tone"] == "casual")
    #expect(card.handle(.right) == .handled && card.arguments.choices["tone"] == "formal")
    #expect(card.handle(.space) == .handled && card.page == .drill(0) && card.selection == 1)
    #expect(card.handle(.digit(1)) == .handled && card.page == .sheet && card.selection == 0)
    #expect(card.arguments.choices["tone"] == "casual")
    #expect(card.handle(.space) == .handled)
    #expect(card.handle(.delete) == .handled && card.page == .sheet)
    #expect(card.handle(.space) == .handled && card.handle(.back) == .handled)
    #expect(card.handle(.tab) == .handled && card.selection == 1)
    #expect(card.handle(.space) == .handled && card.arguments.toggles["short"] == true)
    #expect(card.handle(.left) == .handled && card.arguments.toggles["short"] == false)
    #expect(card.handle(.tab) == .handled && card.handle(.tab) == .handled && card.selection == 0)
    #expect(card.handle(.backTab) == .handled && card.selection == 2)
    let values = CommandArguments(
      output: nil, choices: ["tone": "casual"], toggles: ["short": false])
    #expect(card.handle(.space) == .outcome(.edit(values)))
    #expect(card.handle(.enter) == .outcome(.run(values)))
    #expect(card.click(1) == .handled && card.arguments.toggles["short"] == true)
    #expect(card.click(0) == .handled && card.page == .drill(0))
    #expect(card.runButton() == nil)
    #expect(card.handle(.escape) == .handled && card.page == .sheet)
    #expect(card.handle(.escape) == .outcome(.close))
  }

  @Test("The card is as tall as its rows make room for and as wide as its content, in bounds")
  func cardSize() {
    #expect(IslandMetrics.cardHeight(rows: 2, filter: false) == 12 + 28 + 56 + 4 + 32)
    #expect(IslandMetrics.cardHeight(rows: 0, filter: true) == 12 + 28 + 32 + 28 + 4 + 32)
    #expect(IslandMetrics.cardHeight(rows: 40, filter: false) == 12 + 28 + 224 + 4 + 32)
    #expect(IslandMetrics.cardWidth(ideal: 120) == IslandMetrics.minCardWidth)
    #expect(IslandMetrics.cardWidth(ideal: 333.2) == 334)
    #expect(IslandMetrics.cardWidth(ideal: 900) == IslandMetrics.maxCardWidth)
    let rest = IslandMetrics.rest(WindowSize(width: 100, height: 44))
    #expect(abs(rest.midX - IslandMetrics.canvas.width / 2) < 1e-9)
    // A capsule wider than the island's largest shape cuts its chip first, then its name, then
    // a notice's message, each down to its floor.
    typealias Limits = IslandMetrics.CapsuleLimits
    #expect(Limits.fitting(overflow: 0, command: 300, summary: 220, message: nil) == Limits())
    let chip = Limits.fitting(overflow: 100, command: 300, summary: 220, message: nil)
    #expect(chip.summary == 120 && chip.command == IslandMetrics.maxCommandWidth)
    let name = Limits.fitting(overflow: 300, command: 300, summary: 220, message: nil)
    #expect(name.summary == IslandMetrics.minSummaryWidth && name.command == 172)
    let floors = Limits.fitting(overflow: 900, command: 300, summary: 220, message: nil)
    #expect(floors.summary == IslandMetrics.minSummaryWidth)
    #expect(floors.command == IslandMetrics.minCommandWidth)
    let notice = Limits.fitting(overflow: 50, command: nil, summary: nil, message: 420)
    #expect(notice.message == 370 && notice.command == IslandMetrics.maxCommandWidth)
    #expect(abs(rest.maxY - (IslandMetrics.canvas.height - IslandMetrics.inset)) < 1e-9)
  }
}
