import { google } from "googleapis";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";

function logError(prefix, err) {
  // 共通の詳細ログ
  const data = err?.response?.data;
  const status = err?.response?.status;
  const headers = err?.response?.headers;

  console.error(`\n[${prefix}] ERROR =================================`);
  console.error("name:", err?.name);
  console.error("message:", err?.message);
  if (status) console.error("status:", status);

  // Google API 形式（{ error: { errors: [...], code, message } }）
  if (data?.error) {
    const g = data.error;
    console.error("google.error.code:", g.code);
    console.error("google.error.message:", g.message);
    if (Array.isArray(g.errors)) {
      g.errors.forEach((e, i) => {
        console.error(`google.error.errors[${i}]:`, {
          reason: e.reason,
          domain: e.domain,
          locationType: e.locationType,
          location: e.location,
          message: e.message,
        });
      });
    }
  } else if (data) {
    // 非Google形式のボディ
    console.error("response.data:", data);
  }

  // Axios レイヤの情報
  if (headers) {
    // ヘッダーは量が多いので必要に応じてコメントアウト
    console.error("response.headers:", headers);
  }
  if (err?.stack) console.error("stack:", err.stack);
  console.error("===================================================\n");
}

async function countTodayUploads(youtube) {
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
  } catch (err) {
    logError("YT.countTodayUploads", err);
    // 集計失敗時は0扱いで続行
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
  privacyStatus = "unlisted",
  dailyLimit = 6,
}) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  try {
    // 1日の上限チェック
    const today = await countTodayUploads(youtube);
    if (today >= dailyLimit) {
      console.log(`[YT] daily limit reached (${today}/${dailyLimit}) → skip`);
      return { ok: true, skipped: true };
    }

    // 一時DL
    const tmp = path.join(os.tmpdir(), `upload-${Date.now()}.mp4`);
    let res;
    try {
      res = await axios.get(sourceUrl, { responseType: "stream", timeout: 0 });
    } catch (err) {
      logError("YT.download", err);
      throw new Error("Failed to download sourceUrl");
    }
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
          media: { body: fs.createReadStream(tmp) },
        },
        {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );
      const videoId = up.data.id;
      return { ok: !!videoId, videoId };
    } catch (err) {
      logError("YT.videos.insert", err);
      // 呼び出し元で判定しやすいよう、googleの reason を返す
      const reason = err?.response?.data?.error?.errors?.[0]?.reason;
      return { ok: false, reason };
    } finally {
      fs.unlink(tmp, () => {});
    }
  } catch (outer) {
    logError("YT.outer", outer);
    return { ok: false, reason: outer?.message || "unknown" };
  }
}
