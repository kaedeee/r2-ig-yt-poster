// token-debug.mjs
import { google } from "googleapis";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN; // ←テストしたい方を入れる

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  throw new Error(
    "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN"
  );
}

async function main() {
  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });

  // アクセストークン取得（ここでscopeも分かる）
  const { token } = await oauth2.getAccessToken();
  console.log("access_token acquired");

  // tokeninfo でスコープ確認
  const tinfo = await axios.get(
    "https://www.googleapis.com/oauth2/v3/tokeninfo",
    {
      params: { access_token: token },
    }
  );
  console.log("scopes:", tinfo.data.scope);

  // 自分のチャンネル情報
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const me = await yt.channels.list({ part: ["id", "snippet"], mine: true });
  if ((me.data.items || []).length === 0) {
    console.log("No channel found. Is the account a valid YouTube channel?");
  } else {
    const ch = me.data.items[0];
    console.log("channelId:", ch.id);
    console.log("title:", ch.snippet?.title);
  }
}
main().catch((e) => {
  console.error("DEBUG ERROR:", e.response?.data || e.message || e);
  process.exit(1);
});

// node test/token-debug.mjs
