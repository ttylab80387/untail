// Signs release builds with the upload key when its Gradle properties are set
// (kept in ~/.gradle/gradle.properties, outside the repo); otherwise release builds
// keep using the debug key so anyone can still build the app locally.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// untail-release-signing';
const SIGNING = `
        release { ${MARKER}
            if (project.hasProperty('UNTAIL_UPLOAD_STORE_FILE')) {
                storeFile file(UNTAIL_UPLOAD_STORE_FILE)
                storePassword UNTAIL_UPLOAD_STORE_PASSWORD
                keyAlias UNTAIL_UPLOAD_KEY_ALIAS
                keyPassword UNTAIL_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes(MARKER)) {
      const before = gradle;
      gradle = gradle.replace(/(signingConfigs\s*\{\s*\r?\n\s*debug\s*\{[^}]*\})/, `$1${SIGNING}`);
      const added = gradle !== before;
      const mid = gradle;
      gradle = gradle.replace(
        /(release\s*\{\s*\r?\n(?:\s*\/\/.*\r?\n)*\s*)signingConfig signingConfigs\.debug/,
        "$1signingConfig project.hasProperty('UNTAIL_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      );
      // Both edits must land, or a release build would point at a missing signing config.
      if (!added || gradle === mid) throw new Error('withReleaseSigning: build.gradle layout changed');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
