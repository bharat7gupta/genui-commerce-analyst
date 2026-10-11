---
document_id: demo-commerce-field-currency-tax-shipping
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# Currency, tax, and shipping limitations

The orders table stores decimal gross, discount, and refund amounts, but it has
no currency code or exchange-rate field. It also has no separate columns for
tax, shipping charges, duties, tips, or fees. The schema therefore cannot
establish which currency an amount uses or whether one of those components is
already included in `gross_amount`.

For example, a stored value of `450.00` is only a decimal amount. Labeling it
as dollars, converting it, or separating tax and delivery charges would add
information that the dataset does not provide. Such questions require an
expanded schema and explicit definitions.
