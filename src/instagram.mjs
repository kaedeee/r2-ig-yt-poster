import axios from "axios";

export async function postInstagram({
  igUserId,
  accessToken,
  mediaUrl,
  caption,
}) {
  // 1) コンテナ作成
  const create = await axios.post(
    `https://graph.facebook.com/v20.0/${igUserId}/media`,
    null,
    {
      params: {
        access_token: accessToken,
        media_type: "VIDEO",
        video_url: mediaUrl,
        caption,
      },
      timeout: 60000,
    }
  );
  const creationId = create.data.id;
  // 2) ステータス待ち
  let status = "IN_PROGRESS";
  const start = Date.now();
  while (status === "IN_PROGRESS") {
    await new Promise((r) => setTimeout(r, 5000));
    const q = await axios.get(
      `https://graph.facebook.com/v20.0/${creationId}`,
      {
        params: { fields: "status_code", access_token: accessToken },
        timeout: 30000,
      }
    );
    status = q.data.status_code || "IN_PROGRESS";
    if (Date.now() - start > 5 * 60 * 1000)
      throw new Error("IG: timeout waiting container");
  }
  if (status !== "FINISHED") {
    throw new Error(`IG: container status ${status}`);
  }

  // 3) publish
  const pub = await axios.post(
    `https://graph.facebook.com/v20.0/${igUserId}/media_publish`,
    null,
    {
      params: { access_token: accessToken, creation_id: creationId },
      timeout: 60000,
    }
  );

  return { ok: !!pub.data.id, id: pub.data.id };
}
