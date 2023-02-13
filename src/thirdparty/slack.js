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

module.exports = {
  send: process.env.APP_ENV === 'production' ? send : async () => {},
};
