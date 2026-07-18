/**
 * GET /license/:github_id — read-only license status. No auth: "active"
 * only means a license exists, and a lapsed updatesUntil doesn't revoke the
 * app (client-side updater gating, no DRM — see docs/RELEASING.md).
 */
import type { Env } from "../lib/env";
import { getLicense } from "../lib/kv";

export const onRequestGet: PagesFunction<Env, "github_id"> = async (context) => {
  const { github_id: param } = context.params;
  const githubId = Array.isArray(param) ? param[0] : param;
  if (!githubId) {
    return new Response("missing github_id", { status: 400 });
  }

  const record = await getLicense(context.env.LICENSES, githubId);
  if (record === null) {
    return Response.json({ active: false });
  }
  return Response.json({ active: true, updatesUntil: record.updatesUntil });
};
