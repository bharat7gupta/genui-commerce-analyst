BEGIN TRANSACTION;

DROP TABLE IF EXISTS orders;

CREATE TABLE orders (
  order_id VARCHAR PRIMARY KEY,
  customer_id VARCHAR NOT NULL,
  order_date DATE NOT NULL,
  region VARCHAR NOT NULL CHECK (region IN ('North', 'South', 'East', 'West')),
  category VARCHAR NOT NULL CHECK (category IN ('Electronics', 'Apparel', 'Home', 'Beauty')),
  gross_amount DECIMAL(12, 2) NOT NULL CHECK (gross_amount >= 0),
  discount_amount DECIMAL(12, 2) NOT NULL CHECK (
    discount_amount >= 0 AND discount_amount <= gross_amount
  ),
  refund_amount DECIMAL(12, 2) NOT NULL CHECK (
    refund_amount >= 0 AND refund_amount <= gross_amount - discount_amount
  ),
  status VARCHAR NOT NULL CHECK (
    (status = 'completed' AND refund_amount = 0) OR
    (
      status = 'partially_refunded' AND
      refund_amount > 0 AND
      refund_amount < gross_amount - discount_amount
    ) OR
    (
      status = 'refunded' AND
      refund_amount = gross_amount - discount_amount
    )
  )
);

INSERT INTO orders VALUES
  ('O001', 'C001', DATE '2025-08-02', 'North', 'Electronics', 1200.00, 100.00,   0.00, 'completed'),
  ('O002', 'C002', DATE '2025-08-04', 'South', 'Apparel',      300.00,  20.00,   0.00, 'completed'),
  ('O003', 'C003', DATE '2025-08-05', 'East',  'Home',         550.00,  50.00,   0.00, 'completed'),
  ('O004', 'C004', DATE '2025-08-07', 'West',  'Beauty',       200.00,   0.00,   0.00, 'completed'),
  ('O005', 'C005', DATE '2025-08-09', 'North', 'Apparel',      450.00,  45.00, 100.00, 'partially_refunded'),
  ('O006', 'C006', DATE '2025-08-11', 'South', 'Electronics',  900.00,   0.00,   0.00, 'completed'),
  ('O007', 'C007', DATE '2025-08-12', 'East',  'Beauty',       180.00,  10.00,   0.00, 'completed'),
  ('O008', 'C008', DATE '2025-08-14', 'West',  'Home',         700.00,  70.00, 200.00, 'partially_refunded'),
  ('O009', 'C009', DATE '2025-08-16', 'North', 'Home',         650.00,   0.00,   0.00, 'completed'),
  ('O010', 'C010', DATE '2025-08-18', 'South', 'Beauty',       250.00,  25.00, 225.00, 'refunded'),
  ('O011', 'C011', DATE '2025-08-20', 'East',  'Electronics', 1100.00, 100.00,   0.00, 'completed'),
  ('O012', 'C012', DATE '2025-08-22', 'West',  'Apparel',      400.00,   0.00,   0.00, 'completed'),
  ('O013', 'C013', DATE '2025-08-25', 'North', 'Beauty',       300.00,  30.00,  50.00, 'partially_refunded'),
  ('O014', 'C014', DATE '2025-08-27', 'South', 'Home',         800.00,  80.00,   0.00, 'completed'),
  ('O015', 'C015', DATE '2025-08-30', 'East',  'Apparel',      350.00,   0.00,   0.00, 'completed'),
  ('O016', 'C016', DATE '2025-09-02', 'North', 'Electronics', 1400.00, 140.00,   0.00, 'completed'),
  ('O017', 'C017', DATE '2025-09-04', 'South', 'Apparel',      500.00,  50.00,   0.00, 'completed'),
  ('O018', 'C018', DATE '2025-09-06', 'East',  'Home',         600.00,   0.00,   0.00, 'completed'),
  ('O019', 'C019', DATE '2025-09-08', 'West',  'Beauty',       220.00,  20.00,  50.00, 'partially_refunded'),
  ('O020', 'C020', DATE '2025-09-10', 'North', 'Apparel',      480.00,   0.00,   0.00, 'completed'),
  ('O021', 'C021', DATE '2025-09-12', 'South', 'Electronics', 1000.00, 100.00, 300.00, 'partially_refunded'),
  ('O022', 'C022', DATE '2025-09-14', 'East',  'Beauty',       260.00,   0.00,   0.00, 'completed'),
  ('O023', 'C023', DATE '2025-09-16', 'West',  'Home',         750.00,  75.00,   0.00, 'completed'),
  ('O024', 'C024', DATE '2025-09-18', 'North', 'Home',         900.00,  90.00,   0.00, 'completed'),
  ('O025', 'C025', DATE '2025-09-20', 'South', 'Beauty',       320.00,  20.00, 300.00, 'refunded'),
  ('O026', 'C026', DATE '2025-09-22', 'East',  'Electronics', 1250.00,  50.00,   0.00, 'completed'),
  ('O027', 'C027', DATE '2025-09-24', 'West',  'Apparel',      420.00,  20.00,   0.00, 'completed'),
  ('O028', 'C028', DATE '2025-09-26', 'North', 'Beauty',       340.00,   0.00,  40.00, 'partially_refunded'),
  ('O029', 'C029', DATE '2025-09-28', 'South', 'Home',         850.00,   0.00,   0.00, 'completed'),
  ('O030', 'C030', DATE '2025-09-30', 'East',  'Apparel',      390.00,  30.00, 100.00, 'partially_refunded');

COMMIT;
