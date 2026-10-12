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

const approvedCommercialBySession = new Map();

function sessionKeyFromToolContext(ctx) {
  if (ctx?.memoryAudience?.kind === "conversation" && ctx.memoryAudience.sessionKey) {
    return String(ctx.memoryAudience.sessionKey);
  }
  return "";
}

function rememberCommercialApproval(sessionKey, result) {
  if (!sessionKey || result?.outcome !== "APPROVE") return;
  approvedCommercialBySession.set(sessionKey, {
    at: Date.now(),
    actionType: result?.action_type || null
  });
}

function hasFreshCommercialApproval(sessionKey) {
  const entry = approvedCommercialBySession.get(String(sessionKey || ""));
  if (!entry) return false;
  if (Date.now() - entry.at > 120000) {
    approvedCommercialBySession.delete(String(sessionKey || ""));
    return false;
  }
  return true;
}

function consumeCommercialApproval(sessionKey) {
  approvedCommercialBySession.delete(String(sessionKey || ""));
}

function looksCommercialSupplierReply(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  const patterns = [
    /\bAED\b/i,
    /\b(price|rate|quote|counter(?:offer)?|discount|per\s+(?:piece|unit))\b/i,
    /\b(confirm(?:ed|ation)?|accept(?:ed|ance)?|award(?:ed)?|order\s+confirmed|deal)\b/i,
    /\b(quantity|qty|pieces?|units?)\b[^\n]{0,30}\b\d+\b/i,
    /\b(delivery|lead\s*time)\b[^\n]{0,30}\b\d+\s*(?:day|days|week|weeks)\b/i
  ];
  return patterns.some((p) => p.test(text));
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
      "When multiple RFQs may match, do not list all active RFQs and do not guess. First call procurement_resolve_rfq_context.",
      "If one supplier message contains itemized quotes for TWO OR MORE products, FIRST log the inbound WhatsApp message to obtain a persisted message_log UUID; then call procurement_process_multi_item_message on the FULL message. Pass native reply_to_message_id whenever available to scope item numbers to the exact quoted outbound bundle. When status MULTI_RFQ_RECORDED, the backend already persisted every mapped item atomically; never record them a second time. If clarification is required, the backend has preserved both resolved and unresolved line facts in a draft. Ask only about ambiguous lines; never assign by message order alone.",
      "If a supplier withdraws or changes an already accepted quote, first record the newly stated quote, then call procurement_mark_quote_revision with the exact new quote ID. Keep the old accepted price historically, but never represent it as currently valid while revision_pending.",
      "Strong context wins: native WhatsApp reply/quote context, an existing active negotiation, or an explicit product/spec reference.",
      "If the resolver returns AMBIGUOUS, persist any already-understood commercial terms with procurement_save_pending_commercial_draft, then ask one short clarification naming only the remaining 2-3 candidates.",
      "When the supplier clarifies, resolve that draft with procurement_resolve_commercial_draft and continue using the preserved facts; never ask them to repeat price/delivery/quantity already captured.",
      "For any commercial action, use the Phase 2 commercial review loop before sending.",
      "Phase 2 negotiation: persist the supplier quote first, read procurement_get_negotiation_context, then choose your OWN counter/strategy.",
      "Judgment examples, not formulas: tiny supplier movement -> usually hold or move minimally; meaningful movement -> consider a controlled reciprocal concession; repeated refusal -> change tactic instead of repeating the exact same counter; favorable quote below target -> never negotiate upward; final above hard authority -> escalate.",
      "Before sending any price/quantity/delivery/acceptance commitment, call procurement_review_commercial_action.",
      "If review returns ADJUST or RETRY, reconsider and call it one more time with attempt_number=2. If still not approved, request Human Attention.",
      "Supplier-facing wording must stay natural and varied; never expose internal targets, limits, guard feedback, tools, or structured assessment.",
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
      name: "procurement_resolve_rfq_context",
      label: "Resolve RFQ Context",
      description: "Resolve the current supplier message against multiple open RFQs using strong context first: native reply context, active negotiation, explicit product/spec clues, then deduction. Returns RESOLVED or a reduced AMBIGUOUS candidate set of at most three RFQs. Use before asking clarification when more than one RFQ may apply.",
      parameters: Type.Object({
        supplier_id: Id,
        message: Type.String(),
        source_message_id: OptionalString,
        reply_to_message_id: OptionalString,
        reply_to_body: OptionalString,
        extracted_facts: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/resolve-rfq-context", {
          ...p,
          client_id: clientId,
          extracted_facts: p.extracted_facts ?? {}
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_process_multi_item_message",
      label: "Safely Process Full Multi-Item Supplier Message",
      description: "Preferred tool when supplier provides prices for multiple RFQs. Validates the ENTIRE message, atomically records all mapped RFQs, or durably saves uncertain facts and returns one targeted clarification. Requires the previously logged inbound message UUID.",
      parameters: Type.Object({
        supplier_id: Id,
        message: Type.String({ minLength: 1 }),
        source_message_id: Id,
        reply_to_message_id: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/process-multi-item-message", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_parse_multi_item_quotes",
      label: "Parse Multi-Item Supplier Price List",
      description: "Parse one WhatsApp message that prices multiple RFQs. Maps each priced line only to authorized supplier RFQs, returning CLARIFICATION_REQUIRED on ambiguity. Does NOT save any quotes.",
      parameters: Type.Object({
        supplier_id: Id,
        message: Type.String({ minLength: 1 }),
        source_message_id: OptionalString,
        reply_to_message_id: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/parse-multi-item-quotes", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_record_multi_item_quotes",
      label: "Record Mapped Multi-Item Quotes",
      description: "Persist an entire validated multi-RFQ supplier price list, using the original persisted inbound message UUID for retry deduplication. Use only after procurement_parse_multi_item_quotes returns MAPPED.",
      parameters: Type.Object({
        supplier_id: Id,
        source_message_id: Id,
        raw_message: Type.String({ minLength: 1 }),
        items: Type.Array(Type.Object({
          candidate_rfq_id: Id,
          product_reference: OptionalString,
          supplier_final: Type.Optional(Type.Boolean()),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
          price: Type.Number({ exclusiveMinimum: 0 }),
          quantity: Type.Optional(Type.Integer({ minimum: 1 })),
          variant_label: OptionalString,
          delivery_time: OptionalString,
          quality_notes: OptionalString
        }, { additionalProperties: false }), { minItems: 2, maxItems: 100 })
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/record-multi-item-quotes", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_mark_quote_revision",
      label: "Mark Previously Accepted Quote Revised",
      description: "Option B: ONLY when a supplier explicitly changes/withdraws a previously accepted offer, pass the newly recorded quote ID to invalidate the current accepted deal, retain historical acceptance and enter revision_pending. Do NOT use for an ordinary new quote.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        new_quote_id: Id
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/mark-quote-revision", { ...p, client_id: clientId }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_save_pending_commercial_draft",
      label: "Save Pending Commercial Draft",
      description: "Persist price, quantity, delivery, availability, or other extracted supplier terms before asking an RFQ clarification. Use whenever the commercial facts are understood but the exact RFQ is still ambiguous, so no detail is lost across clarification turns.",
      parameters: Type.Object({
        supplier_id: Id,
        raw_message: Type.String(),
        candidate_rfq_ids: Type.Array(Id, { maxItems: 8 }),
        extracted_facts: Type.Record(Type.String(), Type.Unknown()),
        source_message_id: OptionalString,
        reply_to_message_id: OptionalString,
        reply_to_body: OptionalString,
        message_kind: OptionalString
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/pending-commercial-draft", {
          ...p,
          client_id: clientId
        }, ctx?.signal);
      }
    }),
    tool({
      name: "procurement_resolve_commercial_draft",
      label: "Resolve Commercial Draft",
      description: "Attach an existing pending commercial draft to the RFQ selected by the supplier's clarification. Returns the preserved extracted facts and raw message. Continue from those facts without asking the supplier to repeat them.",
      parameters: Type.Object({
        supplier_id: Id,
        draft_id: Id,
        rfq_id: Id
      }, { additionalProperties: false }),
      execute: (p, _c, ctx) => {
        const { clientId } = cfg();
        return post("/openclaw/resolve-commercial-draft", {
          ...p,
          client_id: clientId
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
      async execute(p, _c, ctx) {
        const { clientId } = cfg();
        const sessionKey = sessionKeyFromToolContext(ctx);
        const result = await post("/openclaw/review-commercial-action", {
          ...p,
          client_id: clientId,
          session_key: sessionKey || null,
          assessment: p.assessment ?? {}
        }, ctx?.signal);
        if (result?.outcome === "APPROVE") {
          rememberCommercialApproval(sessionKey, { ...result, action_type: p.action_type });
        }
        return result;
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
      description: "Persist acceptance of an exact supplier quote after hard commercial approval. When revision_pending, the explicit pending revised quote_id is REQUIRED. Do not confirm acceptance before this succeeds.",
      parameters: Type.Object({
        supplier_id: Id,
        rfq_id: Id,
        quote_id: Type.Optional(Id),
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
        "procurement_resolve_rfq_context",
        "procurement_process_multi_item_message",
        "procurement_parse_multi_item_quotes",
        "procurement_record_multi_item_quotes",
        "procurement_mark_quote_revision",
        "procurement_save_pending_commercial_draft",
        "procurement_resolve_commercial_draft",
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

  api.on("before_agent_finalize", (event, context) => {
    const channel = String(context?.channel || context?.channelId || "").toLowerCase();
    if (channel !== "whatsapp") return undefined;

    const finalText = String(event?.lastAssistantMessage || "").trim();
    if (!looksCommercialSupplierReply(finalText)) return undefined;

    const sessionKey = String(context?.sessionKey || "");
    if (hasFreshCommercialApproval(sessionKey)) return undefined;

    return {
      action: "revise",
      reason: "commercial_action_requires_backend_review",
      retry: {
        instruction: [
          "Your proposed supplier reply contains a commercial action or commercial-state reference.",
          "Before finalizing, persist any supplier quote if needed, read negotiation context, then call procurement_review_commercial_action.",
          "If the guard returns APPROVE, produce a natural supplier-facing reply.",
          "If ADJUST or RETRY, reconsider and submit one second proposal only.",
          "If ESCALATE/REJECT, do not make the commitment; request Human Attention and use a brief holding reply only if context requires it."
        ].join(" "),
        idempotencyKey: `procurement-commercial-review:${sessionKey || event?.runId || "unknown"}`,
        maxAttempts: 2
      }
    };
  });

  // Supplier-safety boundary: internal model/provider failures are operational
  // data, never supplier-facing WhatsApp content.
  api.on("message_sending", (event, context) => {
    const channelId = String(context?.channelId || "").toLowerCase();
    if (channelId !== "whatsapp") return undefined;

    if (looksLikeInternalProviderError(event?.content)) {
      api.logger?.error?.(
        "[supplier-safety] suppressed internal provider/runtime error from WhatsApp delivery"
      );
      return {
        cancel: true,
        cancelReason: "supplier_safety_provider_error"
      };
    }

    if (looksCommercialSupplierReply(event?.content)) {
      const sessionKey = String(context?.sessionKey || "");
      if (!hasFreshCommercialApproval(sessionKey)) {
        api.logger?.error?.(
          "[commercial-authority] blocked unreviewed commercial WhatsApp reply"
        );
        return {
          cancel: true,
          cancelReason: "commercial_action_not_reviewed"
        };
      }
      consumeCommercialApproval(sessionKey);
    }

    return undefined;
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
