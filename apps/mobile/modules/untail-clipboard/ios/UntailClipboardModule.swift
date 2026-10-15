import ExpoModulesCore
import UIKit

public class UntailClipboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UntailClipboard")

    // Neither the change count nor the pattern check reads the contents, so iOS shows no paste prompt.
    // UIPasteboard.hasURLs only sees URL-typed items, but many apps copy links as plain text,
    // which detectPatterns(.probableWebURL) also recognises.
    AsyncFunction("stateAsync") { (promise: Promise) in
      let pasteboard = UIPasteboard.general
      let changeCount = pasteboard.changeCount
      if pasteboard.hasURLs {
        promise.resolve(["hasUrl": true, "changeCount": changeCount])
        return
      }
      pasteboard.detectPatterns(for: [.probableWebURL]) { result in
        var found = false
        if case .success(let patterns) = result {
          found = patterns.contains(.probableWebURL)
        }
        promise.resolve(["hasUrl": found, "changeCount": changeCount])
      }
    }
  }
}
