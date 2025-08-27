import { google } from "googleapis";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = "http://localhost:3000";

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);

// ★ 広めの権限（どちらかでOK）
// const scopes = ["https://www.googleapis.com/auth/youtube"]; // これ1本でもOK
const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
const url = oauth2Client.generateAuthUrl({
  access_type: "offline", // ★refresh_tokenをもらうために必須
  prompt: "consent",
  scope: scopes,
});

console.log("このURLを開いて承認してください：", url);

// ターミナルで認可コードを入力
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question("認可コードを貼り付けて： ", async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  console.log("取得したトークン:", tokens);
  rl.close();
});

// node test/youtube_refresh_token.mjs
