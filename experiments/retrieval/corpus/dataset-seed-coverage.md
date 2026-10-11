---
document_id: demo-commerce-dataset-seed-coverage
version: 1
effective_date: 2025-08-01
source: data/seed.sql
tenant: demo-commerce
---
# Seed Dataset Coverage

The deterministic fixture contains 30 orders dated from 2025-08-02 through 2025-09-30. It covers four regions, four categories, and the three supported statuses, but it is a compact test dataset rather than a complete business history. Absence from this fixture is not evidence that an event never occurred in a real company.

For example, a query restricted to October 2025 matches no seeded orders because the fixture ends in September. That empty result describes fixture coverage only. It should not be generalized into a claim that demo-commerce received no October orders outside the experiment.
