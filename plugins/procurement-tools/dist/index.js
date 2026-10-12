import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

function cfg() {
  const baseUrl = (process.env.PROCUREMENT_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.OPENCLAW_TOOL_API_KEY || "").trim();
  const clientId = (process.env.PROCUREMENT_CLIENT_ID || "").trim();
  if (!baseUrl) throw new Error("PROCUREMENT_API_BASE_URL is not configured.");
  if (!key) throw new Error("OPENCLAW_TOOL_API_KEY is not configured.");
  if (!clientId) throw new Error("PROCUREMENT_CLIENT_ID is not configured.");
  return { baseUrl, key, clientId };
}

async function post(path, payload, signal) {
  const { baseUrl, key } = cfg();
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenClaw-Key": key },
    body: JSON.stringify(payload),
    signal
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { raw: text.slice(0, 1000) }; }
  }
  if (!res.ok) throw new Error(`Procurement bridge failed (${res.status}): ${data.detail || text || "unknown error"}`);
  return data;
}

const Id = Type.String();
const OptionalString = Type.Optional(Type.String());

const plugin = defineToolPlugin({
  id: "procurement-tools",
  name: "MUAI Procurement Tools",
  description: "Authenticated tools backed by the deterministic MUAI procurement backend.",
  tools: (tool) => [
    tool({
      name: "procurement_get_supplier_context",
      label: "Get Supplier Context",
      description: "Read supplier identity, active RFQs, recent conversation history, pause state, and active negotiation session. Use before supplier-facing procurement decisions.",
      parameters: Type.Object({
        supplier_id: Type.Optional(Id),
        phone_number: OptionalString,
        history_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
      }, { additionalProperties: false }),
      async execute(p, _c, ctx) {
        if (!p.supplier_id && !p.phone_number) throw new Error("supplier_id or phone_number is required.");
        const { clientId } = cfg();
        return post("/openclaw/supplier-context", {
          client_id: clientId,
          supplier_id: p.supplier_id,
          phone_number: p.phone_number,
          history_limit: p.history_limit ?? 20
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_record_quote",
      label: "Record Supplier Quote",
      description: "Persist supplier quote variants for an RFQ. Record the quote before requesting a negotiation decision.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        variants: Type.Array(Type.Object({
          variant_label: OptionalString,
          price: Type.Optional(Type.Number({ minimum: 0 })),
          delivery_time: OptionalString,
          quality_notes: OptionalString,
          quantity: Type.Optional(Type.Integer({ minimum: 1 })),
          is_available: Type.Optional(Type.Boolean())
        }, { additionalProperties: false }), { minItems: 1 }),
        raw_message: OptionalString,
        source_message_id: OptionalString,
        confidence: OptionalString
      }, { additionalProperties: false }),
      async execute(p, _c, ctx) {
        const { clientId } = cfg();
        return post("/openclaw/record-quote", {
          ...p,
          client_id: clientId,
          confidence: p.confidence ?? "high",
          variants: p.variants.map(v => ({ ...v, is_available: v.is_available ?? true }))
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_mark_unavailable",
      label: "Mark Item Unavailable",
      description: "Record that the supplier reported an RFQ item unavailable or out of stock.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        raw_message: OptionalString,
        source_message_id: OptionalString,
        reason: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/mark-unavailable", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_get_negotiation_decision",
      label: "Get Negotiation Decision",
      description: "Ask the deterministic backend whether to counter, stop, or require human review. Never invent or alter the returned counter price.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        supplier_quote: Type.Number({ exclusiveMinimum: 0 }),
        raw_message: OptionalString,
        extracted_delivery: OptionalString,
        extracted_quantity: Type.Optional(Type.Integer({ minimum: 1 })),
        extracted_variant: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/negotiation-decision", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_request_human_attention",
      label: "Request Human Attention",
      description: "Create an Agent Attention flag for ambiguity, unauthorized trade-offs, supplier-final cases, or other human-review situations.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Type.Optional(Id),
        reason: Type.String(),
        category: OptionalString,
        raw_message: OptionalString,
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
      }, { additionalProperties: false }),
      async execute(p, _c, ctx) {
        const { clientId } = cfg();
        return post("/openclaw/human-attention", {
          ...p,
          client_id: clientId,
          category: p.category ?? "other",
          raw_message: p.raw_message ?? "",
          metadata: p.metadata ?? {}
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_log_message",
      label: "Log Supplier Message",
      description: "Log an inbound or outbound supplier message in the procurement backend. This tool does not send WhatsApp messages.",
      parameters: Type.Object({
        supplier_id: Id,
        direction: Type.Union([Type.Literal("inbound"), Type.Literal("outbound")]),
        body: Type.String(),
        related_rfq_id: Type.Optional(Id),
        status: OptionalString,
        event_key: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/log-message", { ...p, client_id: clientId }, ctx?.signal);
      }
    })
  ]
});

function looksLikeInternalProviderError(content) {
  const text = String(content || "").trim();
  if (!text) return false;

  const strongSignals = [
    /Google Generative AI API error\s*\(\d{3}\)/i,
    /RESOURCE_EXHAUSTED/i,
    /All models failed/i,
    /Context overflow:\s*prompt too large/i,
    /Request too large for model/i,
    /provider.*rate.?limit/i,
    /model.*not found.*Control UI/i,
    /AI service is temporarily overloaded/i,
    /OpenClaw couldn't produce or deliver a reply/i,
    /ask the operator to check the gateway logs/i,
    /Reference:\s*[0-9a-f-]{36}/i,
    /\[code=(?:RESOURCE_EXHAUSTED|UNAVAILABLE|NOT_FOUND)\]/i
  ];

  return strongSignals.some((pattern) => pattern.test(text));
}

const registerProcurementTools = plugin.register.bind(plugin);
plugin.register = (api) => {
  registerProcurementTools(api);

  // Supplier-safety boundary: internal model/provider failures are operational
  // data, never supplier-facing WhatsApp content.
  api.on("message_sending", (event, context) => {
    const channelId = String(context?.channelId || "").toLowerCase();
    if (channelId !== "whatsapp") return undefined;
    if (!looksLikeInternalProviderError(event?.content)) return undefined;

    api.logger?.error?.(
      "[supplier-safety] suppressed internal provider/runtime error from WhatsApp delivery"
    );
    return {
      cancel: true,
      cancelReason: "supplier_safety_provider_error"
    };
  });
};

export default plugin;
