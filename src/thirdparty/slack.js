const { WebClient } = require('@slack/web-api');
const { slack } = require('../config/config');

const web = new WebClient(slack.slackApiKey);
const send = async ({ channelId, username, icon, title, text }) => {
  const result = await web.chat.postMessage({
    channel: channelId,
    username,
    icon_emoji: icon,
    attachments: [
      {
        title,
        text,
      },
    ],
  });
  return result;
};

/**
 * Slack DMs (the per-user "you have been assigned" / "application moved"
 * messages in the controllers) go out from PRODUCTION only. Staging and local
 * runs share the same workspace token, so without this every seeded or test
 * record pinged real people. Set SLACK_DM_ALWAYS=true in an env file to force
 * them on elsewhere (e.g. to test the message text).
 */
const dmEnabled = process.env.APP_ENV === 'production' || process.env.SLACK_DM_ALWAYS === 'true';

module.exports = {
  send: process.env.APP_ENV === 'production' ? send : async () => {},
  dmEnabled,
};
