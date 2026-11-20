import AtdModel
import Foundation

#if DEBUG
  /// Launch arguments that check mini apps on the simulator, which cannot tap (A7, A44). Only
  /// `-AtdDebug miniapp …` is read; other areas' `-AtdDebug` arguments are theirs.
  ///
  ///     -AtdDebug miniapp open <url>              shows a route through the real URL parser
  ///     -AtdDebug miniapp build <sentence> [save] 新建小应用 with the sentence, generating at
  ///                                               once; `save` keeps it shortly after its preview
  ///     -AtdDebug miniapp refine <id> <request>   改一改 on the app, started at once
  ///     -AtdDebug miniapp widget <id>             the app's 小组件 panel with the add guide open
  ///     -AtdDebug miniapp delete <id>             deletes a generated app (cleans up a check)
  enum MiniAppDebug {
    enum Action: Equatable {
      case build(String, save: Bool)
      case refine(id: String, request: String)
      case widget(id: String)
    }

    /// What the 小应用 tab or an app's sheet does once it appears.
    static var pending: Action?

    static func launch(arguments: [String] = ProcessInfo.processInfo.arguments) {
      guard
        let flag = arguments.indices.first(where: {
          arguments[$0] == "-AtdDebug" && arguments.indices.contains($0 + 2)
            && arguments[$0 + 1] == "miniapp"
        })
      else { return }
      let verb = arguments[flag + 2]
      let values = Array(arguments[(flag + 3)...])
      let routes = RouteCenter.shared
      switch verb {
      case "open":
        if let text = values.first, let url = URL(string: text) { routes.open(url) }
      case "build":
        guard let sentence = values.first else { return }
        pending = .build(sentence, save: values.dropFirst().first == "save")
        routes.open(.miniApps)
      case "refine":
        guard values.count >= 2 else { return }
        pending = .refine(id: values[0], request: values[1])
        routes.open(.miniApp(id: values[0]))
      case "widget":
        guard let id = values.first else { return }
        pending = .widget(id: id)
        routes.open(.miniApp(id: id))
      case "delete":
        let model = MiniAppsModel.shared
        if let id = values.first, let app = model.app(id), !app.builtin { try? model.delete(app) }
        routes.open(.miniApps)
      default:
        return
      }
    }

    /// Takes the pending action when `pick` makes something of it.
    static func take<Value>(_ pick: (Action) -> Value?) -> Value? {
      guard let action = pending, let value = pick(action) else { return nil }
      pending = nil
      return value
    }
  }
#else
  enum MiniAppDebug {
    static func launch() {}
  }
#endif
