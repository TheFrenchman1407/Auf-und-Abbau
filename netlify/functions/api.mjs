// Backend der Heimspieltag-Checkliste: speichert Häkchen in Netlify Blobs.
import { getStore } from "@netlify/blobs";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k] ?? "";

export default async (req) => {
  const pin = env("HALLE_PIN");
  if (pin && req.headers.get("x-pin") !== pin) return json({ error: "pin" }, 401);

  const store = getStore({ name: "heimspieltag", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api/, "");

  try {
    if (req.method === "GET" && route === "/state") {
      const { blobs } = await store.list({ prefix: "check/" });
      const checked = {};
      await Promise.all(blobs.map(async (b) => {
        const v = await store.get(b.key, { type: "json" });
        if (v) checked[b.key.slice(6)] = v.at || true;
      }));
      const meta = (await store.get("meta/round", { type: "json" })) || { startedAt: null };
      return json({ checked, startedAt: meta.startedAt, now: Date.now() });
    }

    if (req.method !== "POST") return json({ error: "not found" }, 404);
    let b;
    try { b = JSON.parse(await req.text()); } catch { return json({ error: "bad json" }, 400); }

    if (route === "/toggle") {
      if (!ID_RE.test(b.id || "")) return json({ error: "bad id" }, 400);
      if (b.done) await store.setJSON("check/" + b.id, { at: Date.now() });
      else await store.delete("check/" + b.id);
      return json({ ok: true });
    }

    if (route === "/reset") {
      const { blobs } = await store.list({ prefix: "check/" });
      await Promise.all(blobs.map((x) => store.delete(x.key)));
      await store.setJSON("meta/round", { startedAt: Date.now() });
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: "server", detail: String(e?.message || e) }, 500);
  }
};

export const config = { path: "/api/*" };
