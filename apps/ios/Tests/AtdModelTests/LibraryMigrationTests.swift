import Foundation
import Testing

@testable import AtdModel

/// Libraries the keyboard release wrote (schema 1) open in schema 2 with the card commands added
/// and the person's own changes kept.
@Suite struct LibraryMigrationTests {
  private let directory = FileManager.default.temporaryDirectory
    .appending(path: "LibraryMigrationTests-\(UUID().uuidString)", directoryHint: .isDirectory)

  private var store: SharedStore { SharedStore(directory: directory, notificationName: nil) }

  /// 润色 with new instructions and tone; 帮我回复 with another stance; 翻译 taken out of the
  /// keyboard; 缩短 as shipped; and one command of the person's own, as phase 1 stored them.
  private static let phaseOne = """
    {"body":{"commands":[
    {"adjustments":["再短点","正式点","加个表情"],"id":"polish","input":"text",
     "instructions":"改得更口语一点。","model":{"appDefault":{}},"name":"润色",
     "options":[{"choices":["正式","随意","热情"],"key":"tone","label":"语气","value":"正式"},
                {"choices":["更短","不变","更长"],"key":"length","label":"长度","value":"不变"}],
     "output":{"action":"replace","review":true},
     "placement":{"camera":false,"controls":false,"keyboard":true,"share":false,"siri":false},
     "revision":3,"symbol":"sparkles","tint":"indigo","versionOption":"tone"},
    {"adjustments":["再短点","正式点","加个表情"],"draftVersionOption":"tone","id":"reply",
     "input":"copied","instructions":"根据我复制的消息，替我写一句回复。",
     "model":{"appDefault":{}},"name":"帮我回复",
     "options":[{"choices":["答应","婉拒","再想想"],"key":"stance","label":"态度","value":"婉拒"},
                {"choices":["正式","随意","热情"],"key":"tone","label":"语气","value":"随意"}],
     "output":{"action":"insert","review":true},
     "placement":{"camera":false,"controls":false,"keyboard":true,"share":false,"siri":false},
     "revision":2,"symbol":"arrowshape.turn.up.left","tint":"blue","versionOption":"stance"},
    {"adjustments":["再短点","正式点","加个表情"],"id":"translate","input":"text",
     "instructions":"翻译成目标语言，保留语气。","model":{"appDefault":{}},"name":"翻译",
     "options":[{"choices":["英文","中文","日文"],"key":"to","label":"译成","value":"英文"}],
     "output":{"action":"replace","review":true},
     "placement":{"camera":false,"controls":false,"keyboard":false,"share":false,"siri":false},
     "revision":2,"symbol":"translate","tint":"teal","versionOption":"to"},
    {"adjustments":["再短点","正式点","加个表情"],"id":"shorten","input":"text",
     "instructions":"在不丢信息的前提下缩短。","model":{"appDefault":{}},"name":"缩短",
     "options":[{"choices":["一句话","一半","要点"],"key":"target","label":"目标","value":"一句话"}],
     "output":{"action":"replace","review":true},
     "placement":{"camera":false,"controls":false,"keyboard":true,"share":false,"siri":false},
     "revision":1,"symbol":"scissors","tint":"pink","versionOption":"target"},
    {"adjustments":[],"id":"6F1C2B9E-6D1A-4C33-9C0B-7E1F3A2D4B5C","input":"text",
     "instructions":"按负责人分组列出待办。","model":{"connection":{"id":"c1","model":"m1"}},
     "name":"整理待办","options":[],"output":{"action":"insert","review":false},
     "placement":{"camera":false,"controls":false,"keyboard":true,"share":false,"siri":false},
     "revision":4,"symbol":"checklist","tint":"mint"}
    ]},"revision":9,"schemaVersion":1}
    """

  private func write(_ file: String) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(file.utf8).write(to: store.url(for: CommandLibrary.self))
  }

  private func builtin(_ id: String) throws -> Command {
    try #require(BuiltinCommands.all().first { $0.id == id })
  }

  @Test func aPhaseOneLibraryGainsTheCardCommandsAndKeepsItsEdits() throws {
    try write(Self.phaseOne)
    let snapshot = store.load(CommandLibrary.self)
    #expect(snapshot.source == .stored)
    #expect(snapshot.revision == 9)
    let library = snapshot.document
    #expect(
      library.commands.map(\.id) == [
        "polish", "reply", "translate", "shorten", "event", "expense", "briefing", "whiteboard",
        "6F1C2B9E-6D1A-4C33-9C0B-7E1F3A2D4B5C",
      ])

    // Still where phase 1 put them, so they move to their new places; nothing else changes.
    let polish = try #require(library.command("polish"))
    #expect(polish.placement == CommandPlacement(keyboard: true, share: true, siri: true))
    #expect(polish.instructions == "改得更口语一点。")
    #expect(polish.name == "润色" && polish.values["tone"] == "正式" && polish.revision == 3)
    #expect(library.command("reply")?.placement == CommandPlacement(keyboard: true))
    #expect(library.command("reply")?.values["stance"] == "婉拒")
    #expect(
      library.command("shorten")?.placement == CommandPlacement(keyboard: true, share: true))
    #expect(library.command("shorten")?.output == CommandOutput(action: .replace))

    // Taken out of the keyboard: the person's choice, so it goes nowhere new.
    #expect(library.command("translate")?.placement == CommandPlacement())

    // The person's own command is left exactly as it was.
    let own = try #require(library.command("6F1C2B9E-6D1A-4C33-9C0B-7E1F3A2D4B5C"))
    #expect(own.name == "整理待办" && own.revision == 4)
    #expect(own.placement == CommandPlacement(keyboard: true))
    #expect(own.model == .connection(id: "c1", model: "m1"))
    #expect(own.output.card == nil)

    for id in ["event", "expense", "briefing", "whiteboard"] {
      #expect(try library.command(id) == builtin(id))
    }
  }

  @Test func theNextWriteStoresSchemaTwo() throws {
    try write(Self.phaseOne)
    let migrated = store.load(CommandLibrary.self).document
    try store.update(CommandLibrary.self) { $0.setValue("随意", for: "tone", in: "polish") }
    let rewritten = try String(contentsOf: store.url(for: CommandLibrary.self), encoding: .utf8)
    #expect(rewritten.contains(#""schemaVersion":2"#))
    let reread = store.load(CommandLibrary.self)
    #expect(reread.revision == 10)
    #expect(reread.document.commands.map(\.id) == migrated.commands.map(\.id))
    #expect(reread.document.command("event")?.output.card == .event)
  }

  @Test func missingBuiltinsGoAfterTheLastBuiltinThere() throws {
    var library = CommandLibrary(commands: [])
    let custom = Command(
      id: "mine", name: "Mine", symbol: "star", tint: .gray, instructions: "Do it.",
      input: .text, output: CommandOutput(action: .insert),
      placement: CommandPlacement(keyboard: true))
    let polish = try builtin("polish")
    var keyboardOnly = polish
    keyboardOnly.placement = CommandPlacement(keyboard: true)
    library.commands = [custom, keyboardOnly]
    let migrated = try CommandLibrary.migrate(envelope(library), from: 1)
    #expect(
      migrated.commands.map(\.id) == [
        "mine", "polish", "reply", "translate", "shorten", "event", "expense", "briefing",
        "whiteboard",
      ])
    #expect(migrated.commands[1] == polish)

    let withoutBuiltins = try CommandLibrary.migrate(
      envelope(CommandLibrary(commands: [custom])), from: 1)
    #expect(withoutBuiltins.commands.map(\.id) == BuiltinCommands.all().map(\.id) + ["mine"])
  }

  @Test func onlySchemaOneMigrates() throws {
    let file = try envelope(CommandLibrary.initial())
    #expect(throws: SharedStoreError.unsupportedSchema(file: "library.json", version: 0)) {
      try CommandLibrary.migrate(file, from: 0)
    }
  }

  private func envelope(_ library: CommandLibrary) throws -> Data {
    try JSONEncoder().encode(Envelope(schemaVersion: 1, revision: 1, body: library))
  }
}
