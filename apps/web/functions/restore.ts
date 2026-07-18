/**
 * GET /restore — email-only fallback restore for buyers without their
 * GitHub account handy. Stubbed: the real lookup needs Polar's Customer
 * API, which needs a live Polar account. Wired and routable now so the
 * shape exists; returns its own incompleteness rather than faking success.
 */
export const onRequestGet: PagesFunction = async () => {
  return Response.json({ error: "not yet configured" }, { status: 501 });
};
