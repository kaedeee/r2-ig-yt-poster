import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import axios from "axios";
import { postInstagram } from "./instagram.mjs";
import { uploadYouTube } from "./youtube.mjs";

// ==== 環境変数 ====
const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,

  IG_ACCOUNTS, // ★ JSON配列
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  YT_ACCOUNTS, // ★ JSON配列

  POST_WINDOW_JST = "10-18",
  YT_DAILY_LIMIT = "6",
  DRY_RUN,
} = process.env;

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET ||
  !R2_PUBLIC_BASE_URL
) {
  throw new Error("Missing R2 envs.");
}
if (!IG_ACCOUNTS) throw new Error("Missing IG_ACCOUNTS (JSON).");
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !YT_ACCOUNTS) {
  throw new Error(
    "Missing YouTube envs (GOOGLE_CLIENT_ID/SECRET, YT_ACCOUNTS)."
  );
}

const IG_LIST = JSON.parse(IG_ACCOUNTS); // [{ userId, accessToken }, ...]
const YT_LIST = JSON.parse(YT_ACCOUNTS); // [{ refreshToken }, ...]

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ==== ユーティリティ ====
function inPostWindowJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = jst.getUTCHours();
  const [start, end] = POST_WINDOW_JST.split("-").map((n) => parseInt(n, 10));
  return hour >= start && hour <= end;
}

async function pickOneObject() {
  // バケット直下から最年長1件
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 1000 })
  );
  const candidates = (list.Contents || []).filter(
    (o) => o.Key && !o.Key.endsWith("/") && !o.Key.startsWith(".")
  );
  return (
    candidates.sort(
      (a, b) => (a.LastModified || 0) - (b.LastModified || 0)
    )[0] || null
  );
}

function publicUrlForKey(key) {
  const safeKey = key.split("/").map(encodeURIComponent).join("/");
  return `${R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${safeKey}`;
}

async function head200(url) {
  try {
    const res = await axios.head(url, {
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 15000,
    });
    return (
      res.status === 200 &&
      /^video\/mp4|image\//i.test(res.headers["content-type"] || "")
    );
  } catch {
    return false;
  }
}

// === ファイル名→メタ生成 ===
function parseMetaFromFilename(key) {
  // 1) ファイル名（拡張子除去、URLデコード、_→空白、空白正規化）
  const file = decodeURIComponent(key.split("/").pop() || key);
  const base = file.replace(/\.[^.]+$/, ""); // 拡張子除去
  const underscored = base.replace(/_/g, " ");
  const caption = underscored.replace(/\s+/g, " ").trim(); // IG/説明 共通

  // 2) YouTube タイトルは先頭100文字に丸め（サロゲートに配慮）
  const title = [...caption].slice(0, 100).join("");

  return { caption, ytTitle: title, ytDescription: caption };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==== メイン ====
async function main() {
  console.log(`[start] ${new Date().toISOString()}`);

  if (!inPostWindowJST()) {
    console.log(`Skip: outside JST window ${POST_WINDOW_JST}`);
    return;
  }

  const obj = await pickOneObject();
  if (!obj) {
    console.log("No object to post.");
    return;
  }
  const key = obj.Key;
  const url = publicUrlForKey(key);
  console.log(`Picked: ${key}`);
  console.log(`URL: ${url}`);

  if (!(await head200(url))) {
    throw new Error(`Public URL is not 200 or invalid content-type: ${url}`);
  }

  // メタ生成
  const { caption, ytTitle, ytDescription } = parseMetaFromFilename(key);
  console.log(`IG caption: ${caption}`);
  console.log(`YT title: ${ytTitle}`);

  // ランダムにアカウントを選択
  const igAcc = pickRandom(IG_LIST);
  const ytAcc = pickRandom(YT_LIST);

  // ===== Instagram =====
  let igOk = false;
  try {
    if (DRY_RUN === "1") {
      console.log("[IG] DRY_RUN → skip");
      igOk = true;
    } else {
      const igRes = await postInstagram({
        igUserId: igAcc.userId,
        accessToken: igAcc.accessToken,
        mediaUrl: url,
        caption,
      });
      igOk = igRes.ok;
      console.log(`[IG] ${igOk ? "OK" : "NG"} id=${igRes.id || "-"}`);
    }
  } catch (e) {
    console.error("[IG] error", e?.response?.data || e);
  }

  // ===== YouTube =====
  let ytOk = false;
  try {
    if (DRY_RUN === "1") {
      console.log("[YT] DRY_RUN → skip");
      ytOk = true;
    } else {
      const ytRes = await uploadYouTube({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        refreshToken: ytAcc.refreshToken,
        sourceUrl: url,
        title: ytTitle,
        description: ytDescription,
        privacyStatus: "public",
        dailyLimit: parseInt(YT_DAILY_LIMIT, 10),
      });
      ytOk = ytRes.ok;
      console.log(`[YT] ${ytOk ? "OK" : "NG"} videoId=${ytRes.videoId || "-"}`);
    }
  } catch (e) {
    console.error("[YT] error", e?.response?.data || e);
  }

  // ===== 成功したら削除 =====
  if (igOk && ytOk) {
    if (DRY_RUN === "1") {
      console.log(`[DELETE] DRY_RUN → skip delete ${key}`);
    } else {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      console.log(`[DELETE] deleted: ${key}`);
    }
  } else {
    console.log(`[KEEP] kept: ${key} (IG:${igOk} / YT:${ytOk})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
