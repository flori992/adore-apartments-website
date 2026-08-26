import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) return JSON.parse(keys).default;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function dbHeaders(key: string) {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function rpc(name: string, payload: Record<string, unknown>) {
  const key = secretKey();
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: dbHeaders(key),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Database error");
  return data;
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1] || "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => signature.length === expected.length && signature === expected);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  if (!webhookSecret) return new Response("Webhook not configured", { status: 503 });

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  if (!(await verifySignature(payload, signature, webhookSecret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const event = JSON.parse(payload);
    const session = event.data?.object || {};
    const holdId = session.metadata?.website_hold_id;
    if (!holdId) return new Response("ok", { status: 200 });

    if (event.type === "checkout.session.completed" && session.payment_status === "paid") {
      await rpc("confirm_website_card_booking", {
        p_hold_id: holdId,
        p_stripe_session_id: session.id,
        p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : "",
        p_amount_minor: session.amount_total,
        p_currency: session.currency,
      });
    } else if (event.type === "checkout.session.expired") {
      await rpc("expire_website_card_hold", {
        p_hold_id: holdId,
        p_stripe_session_id: session.id,
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
