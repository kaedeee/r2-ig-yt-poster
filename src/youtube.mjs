import { google } from "googleapis";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";

async function countTodayUploads(youtube) {
  // 軽量に「今日の非ライブ動画アップロード数」を概算（公開APIの都合上ざっくり）
  // 厳密管理はスケジュール側で時間帯を絞るのが安全
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const res = await youtube.search.list({
      part: ["id"],
      forMine: true,
      type: ["video"],
      publishedAfter: start,
      maxResults: 50,
    });
    return (res.data.items || []).length;
  } catch {
    return 0;
  }
}

export async function uploadYouTube({
  clientId,
  clientSecret,
  refreshToken,
  sourceUrl,
  title,
  description,
  privacyStatus = "public",
  dailyLimit = 6,
}) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  // 1日の上限チェック（超えてたらIGだけにしてスキップ）
  const today = await countTodayUploads(youtube);
  if (today >= dailyLimit) {
    console.log(`[YT] daily limit reached (${today}/${dailyLimit}) → skip`);
    return { ok: true, skipped: true };
  }

  // 一時DL（安定のためファイルに落としてからアップ）
  const tmp = path.join(os.tmpdir(), `upload-${Date.now()}.mp4`);
  const res = await axios.get(sourceUrl, {
    responseType: "stream",
    timeout: 0,
  });
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    res.data.pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
  });

  try {
    const up = await youtube.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: path.basename(title, path.extname(title)),
            description,
          },
          status: { privacyStatus },
        },
        media: {
          body: fs.createReadStream(tmp),
        },
      },
      {
        // 大きい動画向けに上限引き上げ
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    const videoId = up.data.id;
    return { ok: !!videoId, videoId };
  } finally {
    fs.unlink(tmp, () => {});
  }
}
