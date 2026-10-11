import type { SourceDocument } from "./document-chunker.js";

export const refundPolicyV2Fixture: SourceDocument = {
  documentId: "refund-policy-long",
  version: 2,
  text: "Refunds must return to the original payment method within five business days of approval. If that method cannot accept the refund, support may issue store credit after recording the failed attempt and contacting the customer.",
  metadata: {
    tenant: "demo-commerce",
    effectiveDate: "2026-11-01",
    source: "day-09-synthetic-fixture-v2",
    title: "Refund destination policy",
    fixture: true,
  },
};

export const otherTenantRefundPolicyFixture: SourceDocument = {
  documentId: "refund-policy-long",
  version: 1,
  text: "Other Shop returns approved refunds to the original payment method.",
  metadata: {
    tenant: "other-shop",
    effectiveDate: "2026-10-15",
    source: "day-09-other-tenant-fixture",
    title: "Other Shop refund policy",
    fixture: true,
  },
};
