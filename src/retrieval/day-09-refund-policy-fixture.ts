import type { SourceDocument } from "./document-chunker.js";

export const refundPolicyFixture: SourceDocument = {
  documentId: "refund-policy-long",
  version: 1,
  text: `Refund rule. Approved refunds must be returned to the original payment method after the support agent verifies the order number, refund amount, and recorded customer identity. The refund should be submitted within five business days of approval. Support must record the approval reference and must not substitute store credit merely to shorten processing time. These requirements apply to full and partial refunds, including a partial refund created after another adjustment on the same order.

Exception. If the original payment method is closed or technically unable to accept the refund, support may use the documented store-credit fallback only after contacting the customer and recording the failed return attempt. This exception changes the permitted destination but does not waive identity verification, approval recording, or the five-business-day submission target. A customer preference for another card is not enough to invoke the exception.`,
  metadata: {
    tenant: "demo-commerce",
    effectiveDate: "2026-10-11",
    source: "day-09-synthetic-fixture",
    title: "Refund destination rule and exception",
    fixture: true,
  },
};
