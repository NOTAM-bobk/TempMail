export default {
  async email(message, env, ctx) {
    const reader = message.raw.getReader();
    const decoder = new TextDecoder("utf-8");
    let rawEmail = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawEmail += decoder.decode(value, { stream: true });
    }

    const recipient = message.to;
    
    const emailPayload = {
      id: crypto.randomUUID(),
      from: message.from,
      subject: message.headers.get("subject") || "(No Subject)",
      body: rawEmail, 
      timestamp: Date.now()
    };

    const existingMailsRaw = await env.TEMP_MAIL_KV.get(recipient);
    const mails = existingMailsRaw ? JSON.parse(existingMailsRaw) : [];
    mails.push(emailPayload);

    await env.TEMP_MAIL_KV.put(recipient, JSON.stringify(mails), { expirationTtl: 3600 });
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const emailAddress = url.searchParams.get("email");

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!emailAddress) {
      return new Response(JSON.stringify({ error: "Missing email parameter" }), { status: 400, headers: corsHeaders });
    }

    const mails = await env.TEMP_MAIL_KV.get(emailAddress);
    return new Response(mails || "[]", { headers: corsHeaders });
  }
};
