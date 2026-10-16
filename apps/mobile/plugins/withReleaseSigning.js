// Signs release builds with the upload key when its Gradle properties are set
// (kept in ~/.gradle/gradle.properties, outside the repo); otherwise release builds
// keep using the debug key so anyone can still build the app locally.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
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
    if (!gradle.includes('UNTAIL_UPLOAD_STORE_FILE')) {
      gradle = gradle.replace(/(signingConfigs \{\n\s+debug \{[^}]*\})/, `$1${SIGNING}`);
      gradle = gradle.replace(
        /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
        "$1signingConfig project.hasProperty('UNTAIL_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      );
      if (!gradle.includes('signingConfigs.release :')) throw new Error('withReleaseSigning: build.gradle layout changed');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
