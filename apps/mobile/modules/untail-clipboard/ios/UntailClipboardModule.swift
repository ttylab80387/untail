import ExpoModulesCore
import UIKit

public class UntailClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UntailClipboard")

    // UIPasteboard.hasURLs only sees URL-typed items, but many apps copy links as plain text.
    // detectPatterns checks plain text too and, like hasURLs, does not trigger the paste prompt.
    AsyncFunction("hasWebUrlAsync") { (promise: Promise) in
      let pasteboard = UIPasteboard.general
      if pasteboard.hasURLs {
        promise.resolve(true)
        return
      }
      pasteboard.detectPatterns(for: [.probableWebURL]) { result in
        switch result {
        case .success(let found):
          promise.resolve(found.contains(.probableWebURL))
        case .failure:
          promise.resolve(false)
        }
      }
    }
  }
}
