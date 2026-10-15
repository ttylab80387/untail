Pod::Spec.new do |s|
  s.name           = 'UntailClipboard'
  s.version        = '1.0.0'
  s.summary        = 'Detects a web link on the clipboard without the iOS paste prompt'
  s.license        = 'MIT'
  s.author         = 'Untail'
  s.homepage       = 'https://github.com/ttylab80387/untail'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
