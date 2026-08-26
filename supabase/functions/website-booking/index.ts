import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE_ORIGIN = "https://flori992.github.io";
const SITE_URL = "https://flori992.github.io/adore-apartments-website/";

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) return JSON.parse(keys).default;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === SITE_ORIGIN ? SITE_ORIGIN : SITE_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = SITE_ORIGIN) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
  if (!response.ok) throw new Error(data.message || "Booking service error");
  return data;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function releaseHold(holdId: string, sessionId: string | null = null) {
  try {
    await rpc("expire_website_card_hold", { p_hold_id: holdId, p_stripe_session_id: sessionId });
  } catch (error) {
    console.error("Could not release hold", error);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (origin && origin !== SITE_ORIGIN) return json({ error: "This booking request is not allowed." }, 403, origin);

  try {
    if (req.method === "GET") {
      const sessionId = new URL(req.url).searchParams.get("session_id") || "";
      if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId) || sessionId.length > 255) {
        return json({ error: "Invalid payment session." }, 400, origin);
      }
      return json(await rpc("get_website_booking_status", { p_stripe_session_id: sessionId }), 200, origin);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
    const body = await req.json();
    if (body.company) return json({ error: "Booking could not be submitted." }, 400, origin);

    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
    const allowed = await rpc("check_website_booking_rate_limit", { p_ip_hash: await sha256(ip) });
    if (!allowed) return json({ error: "Too many booking attempts. Please try again later." }, 429, origin);

    const paymentMethod = String(body.paymentMethod || "").toLowerCase();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    if (paymentMethod === "card" && !stripeKey) {
      return json({ error: "Card payments are being connected. Please choose cash for now." }, 503, origin);
    }

    const booking = await rpc("start_website_booking", {
      p_website_property_id: body.propertyId,
      p_check_in: body.checkIn,
      p_check_out: body.checkOut,
      p_guests: Number(body.guests),
      p_full_name: body.fullName,
      p_email: body.email,
      p_phone: body.phone,
      p_message: body.message || "",
      p_payment_method: paymentMethod,
    });

    if (booking.type === "cash") return json(booking, 200, origin);

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("submit_type", "book");
    params.set("payment_method_types[0]", "card");
    params.set("customer_email", String(body.email || ""));
    params.set("client_reference_id", booking.hold_id);
    params.set("success_url", `${SITE_URL}?booking=success&session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${SITE_URL}?booking=cancelled`);
    params.set("expires_at", String(Math.floor(Date.now() / 1000) + 30 * 60));
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", String(booking.currency).toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(booking.amount_minor));
    params.set("line_items[0][price_data][product_data][name]", `${booking.property_name} · ${booking.check_in} to ${booking.check_out}`);
    params.set("metadata[website_hold_id]", booking.hold_id);
    params.set("payment_intent_data[metadata][website_hold_id]", booking.hold_id);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `website-hold-${booking.hold_id}`,
      },
      body: params,
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.id || !session.url) {
      await releaseHold(booking.hold_id);
      console.error("Stripe session error", session);
      return json({ error: "Stripe could not start the payment. Please try again." }, 502, origin);
    }

    try {
      await rpc("attach_website_stripe_session", {
        p_hold_id: booking.hold_id,
        p_stripe_session_id: session.id,
      });
    } catch (error) {
      await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`, {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}` },
      }).catch(() => undefined);
      await releaseHold(booking.hold_id);
      throw error;
    }

    return json({ type: "card", checkoutUrl: session.url }, 200, origin);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Booking could not be submitted.";
    const safeMessage = message.includes("dates") || message.includes("guests") || message.includes("valid") || message.includes("maximum")
      ? message
      : "Booking could not be submitted. Please try again.";
    return json({ error: safeMessage }, 400, origin);
  }
});
