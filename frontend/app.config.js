const appJson = require("./app.json");

const metaAppId = process.env.EXPO_PUBLIC_META_APP_ID;
const metaClientToken = process.env.EXPO_PUBLIC_META_CLIENT_TOKEN;

const plugins = [...appJson.expo.plugins];

if (metaAppId && metaClientToken) {
  plugins.push([
    "react-native-fbsdk-next",
    {
      appID: metaAppId,
      clientToken: metaClientToken,
      displayName: "meemz",
      scheme: `fb${metaAppId}`,
      isAutoInitEnabled: true,
      autoLogAppEventsEnabled: true,
      advertiserIDCollectionEnabled: false,
    },
  ]);
}

module.exports = {
  ...appJson.expo,
  plugins,
  extra: {
    ...appJson.expo.extra,
    metaAppEventsConfigured: Boolean(metaAppId && metaClientToken),
  },
};
