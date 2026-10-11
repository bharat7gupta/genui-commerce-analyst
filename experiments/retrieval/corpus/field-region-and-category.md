---
document_id: demo-commerce-field-region-and-category
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---

# Region and category fields

Each order has required `region` and `category` fields. The seeded schema
allows exactly four regions—`North`, `South`, `East`, and `West`—and four
categories—`Electronics`, `Apparel`, `Home`, and `Beauty`. Values outside
those lists violate the table constraints.

For example, O008 belongs to the `West` region and `Home` category. Region and
category describe an order and can support grouping or filtering, but the
dataset contains no country, city, warehouse, product identifier, brand, or
category hierarchy. It also does not define relationships between a region and
a currency or tax jurisdiction.
