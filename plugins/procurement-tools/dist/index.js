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

function normalizeSenderPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function activationGuidance(gate) {
  if (gate?.has_procurement_state) {
    return [
      "[MUAI PROCUREMENT ACTIVATION]",
      "This supplier currently has live procurement state.",
      `Active RFQs: ${gate.active_rfq_count || 0}`,
      `Active negotiation: ${gate.active_negotiation ? "yes" : "no"}`,
      `Pending clarification: ${gate.pending_clarification ? "yes" : "no"}`,
      `Pending human attention: ${gate.pending_human_attention ? "yes" : "no"}`,
      "Treat the current message in the context of the supplier's real procurement state.",
      "For any commercial action, use the Phase 2 commercial review loop before sending.",
    ].join("\n");
  }

  return [
    "[MUAI NO ACTIVE PROCUREMENT CONTEXT]",
    "There is currently no active RFQ, negotiation, pending clarification, or pending human-attention workflow for this supplier.",
    "Do NOT invent an RFQ, price discussion, order, product, or procurement context.",
    "Classify the current message by meaning:",
    "- Clearly casual/personal/social: usually return NO_REPLY. A brief natural casual reply is allowed only when it genuinely fits the conversation.",
    "- Clearly business/procurement-related despite no active RFQ: you may send one short context-appropriate acknowledgement, then create Human Attention internally. Do not start negotiation or invent an RFQ.",
    "- Ambiguous/unclear: prefer NO_REPLY and create Human Attention internally. Do not guess.",
    "Never tell the supplier that a human escalation/Agent Attention was created.",
  ].join("\n");
}

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
      name: "procurement_get_negotiation_context",
      label: "Get Negotiation Context",
      description: "Read the hard commercial facts for an RFQ: buyer targets/limits, supplier quote history, active negotiation state, and authorized trade-off constraints. In Phase 2 YOU choose the negotiation strategy and counter; this tool does not choose it for you.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/negotiation-context", {
          ...p,
          client_id: clientId
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_review_commercial_action",
      label: "Review Commercial Action",
      description: "Submit your proposed commercial action to the minimal hard guard before sending it to the supplier. The guard does NOT choose strategy or wording. It returns APPROVE, ADJUST, RETRY, ESCALATE, or REJECT. On ADJUST/RETRY, reconsider and call once more with attempt_number=2. Never send a commercial commitment before APPROVE.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Type.Optional(Id),
        quote_id: Type.Optional(Id),
        action_type: Type.String(),
        attempt_number: Type.Integer({ minimum: 1, maximum: 2 }),
        proposal: Type.Record(Type.String(), Type.Unknown()),
        assessment: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/review-commercial-action", {
          ...p,
          client_id: clientId,
          session_key: ctx?.memoryAudience?.kind === "conversation"
            ? ctx.memoryAudience.sessionKey
            : null,
          assessment: p.assessment ?? {}
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
      description: "Legacy deterministic negotiation tool retained for rollback/testing. Phase 2 default: do NOT use this tool to choose counters. Use procurement_get_negotiation_context, propose your own strategy/counter, then procurement_review_commercial_action.",
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
      name: "procurement_accept_negotiated_quote",
      label: "Accept Negotiated Quote",
      description: "Persist acceptance of a supplier quote. Use this before telling the supplier an order/quote is confirmed. After the RFQ deadline, acceptance is allowed only when the backend confirms an existing in-flight negotiation for this supplier/RFQ.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        price: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        quantity: Type.Optional(Type.Integer({ minimum: 1 }))
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/accept-negotiated-quote", {
          ...p,
          client_id: clientId,
          accepted_by: "openclaw"
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

  api.on("before_prompt_build", async (event, context) => {
    const channel = String(context?.channel || context?.channelId || "").toLowerCase();
    if (channel !== "whatsapp") return undefined;

    const phone = normalizeSenderPhone(context?.senderId || context?.senderExternalId || context?.chatId);
    if (!phone) {
      return {
        appendContext: [
          "[MUAI ACTIVATION WARNING]",
          "The WhatsApp sender identity could not be resolved for this turn.",
          "Do not make a commercial commitment. If context is unclear, return NO_REPLY."
        ].join("\n")
      };
    }

    try {
      const { clientId } = cfg();
      const gate = await post("/openclaw/activation-gate", {
        client_id: clientId,
        phone_number: phone,
        message: String(event?.currentUserMessage || event?.prompt || "")
      });

      const procurementTools = [
        "procurement_get_supplier_context",
        "procurement_get_negotiation_context",
        "procurement_record_quote",
        "procurement_mark_unavailable",
        "procurement_review_commercial_action",
        "procurement_request_human_attention",
        "procurement_accept_negotiated_quote",
        "procurement_log_message"
      ];

      if (!gate?.has_procurement_state) {
        return {
          appendContext: activationGuidance(gate),
          toolsAllow: [
            "procurement_request_human_attention",
            "procurement_log_message"
          ]
        };
      }

      return {
        appendContext: activationGuidance(gate),
        toolsAllow: procurementTools
      };
    } catch (err) {
      api.logger?.warn?.(
        `[procurement-activation] activation lookup failed: ${err?.message || err}`
      );
      return {
        appendContext: [
          "[MUAI ACTIVATION FAIL-SAFE]",
          "Procurement activation state could not be verified.",
          "Do not guess or make a commercial commitment.",
          "Prefer NO_REPLY unless a brief context-appropriate holding response is clearly necessary."
        ].join("\n"),
        toolsAllow: ["procurement_request_human_attention", "procurement_log_message"]
      };
    }
  });

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

  api.on("message_sent", async (event, context) => {
    const channelId = String(context?.channelId || "").toLowerCase();
    if (channelId !== "whatsapp") return;

    try {
      const { clientId } = cfg();
      await post("/openclaw/message-delivery", {
        client_id: clientId,
        phone_number: event?.to,
        body: String(event?.content || ""),
        success: Boolean(event?.success),
        external_message_id: event?.messageId || null,
        error: event?.error || null
      });
    } catch (err) {
      api.logger?.warn?.(
        `[procurement-delivery] failed to reconcile WhatsApp delivery: ${err?.message || err}`
      );
    }
  });
};

export default plugin;
