import AIShell

/// The App target stays thin: all behavior lives in the `AIMac` package.
@main
enum AIApp {
  @MainActor
  static func main() {
    ShellApplication.run()
  }
}
