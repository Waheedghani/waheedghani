-- ============================================================================
-- SARAI ERP — Phase 2: Parties & products
-- Suppliers (Malaysia), warehouses (سرای), sarafs (صراف), products & variants.
-- Every party row automatically receives its own ledger account:
--   suppliers  -> 2000-xxxx  supplier_payable
--   warehouses -> 1400-xxxx  warehouse_receivable
--   sarafs     -> 1500-xxxx  saraf
-- ============================================================================

CREATE TYPE product_category AS ENUM ('oil', 'sugar');
CREATE TYPE product_unit     AS ENUM ('bottle', 'kg', 'bag');

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  name_ps    text NOT NULL DEFAULT '',
  category   product_category NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

CREATE TABLE product_variants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id),
  label      text NOT NULL,
  label_ps   text NOT NULL DEFAULT '',
  unit       product_unit NOT NULL,
  size_value numeric(14,3) NULL,  -- litres per bottle for oil (5/10/16/20)
  kg_per_bag numeric(14,3) NULL,  -- sugar bag weight; editable
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT pv_bag_weight CHECK ((unit = 'bag') = (kg_per_bag IS NOT NULL)),
  CONSTRAINT pv_bottle_size CHECK (unit <> 'bottle' OR size_value IS NOT NULL),
  CONSTRAINT pv_positive CHECK (
    (size_value IS NULL OR size_value > 0) AND (kg_per_bag IS NULL OR kg_per_bag > 0)
  ),
  UNIQUE (product_id, label)
);

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  name_ps    text NOT NULL DEFAULT '',
  country    text NOT NULL DEFAULT 'Malaysia',
  contact    text NULL,
  phone      text NULL,
  address    text NULL,
  account_id uuid NULL UNIQUE REFERENCES accounts (id),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);
CREATE UNIQUE INDEX uq_suppliers_name ON suppliers (lower(name));

CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  name_ps     text NOT NULL DEFAULT '',
  keeper_name text NULL,
  phone       text NULL,
  address     text NULL,
  account_id  uuid NULL UNIQUE REFERENCES accounts (id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL DEFAULT auth.uid(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL
);
CREATE UNIQUE INDEX uq_warehouses_name ON warehouses (lower(name));

CREATE TABLE sarafs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  name_ps    text NOT NULL DEFAULT '',
  phone      text NULL,
  address    text NULL,
  account_id uuid NULL UNIQUE REFERENCES accounts (id),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);
CREATE UNIQUE INDEX uq_sarafs_name ON sarafs (lower(name));

-- app_users.warehouse_id FK (deferred from Phase 0)
ALTER TABLE app_users
  ADD CONSTRAINT app_users_warehouse_fk
  FOREIGN KEY (warehouse_id) REFERENCES warehouses (id);

-- ---------------------------------------------------------------------------
-- Auto-create the party ledger account on insert.
-- SECURITY DEFINER: the inserting office user has no INSERT right on accounts;
-- the trigger runs as the schema owner. TG_ARGV = (range, account_type).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_party_auto_account()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_range int := TG_ARGV[0]::int;
  v_type  account_type := TG_ARGV[1]::account_type;
BEGIN
  IF NEW.account_id IS NULL THEN
    INSERT INTO accounts (code, name, name_ps, type)
    VALUES (fn_next_account_code(v_range), NEW.name, coalesce(NEW.name_ps, ''), v_type)
    RETURNING id INTO NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_account BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION fn_party_auto_account(2000, 'supplier_payable');
CREATE TRIGGER trg_warehouse_account BEFORE INSERT ON warehouses
  FOR EACH ROW EXECUTE FUNCTION fn_party_auto_account(1400, 'warehouse_receivable');
CREATE TRIGGER trg_saraf_account BEFORE INSERT ON sarafs
  FOR EACH ROW EXECUTE FUNCTION fn_party_auto_account(1500, 'saraf');

-- Keep the ledger account name in sync when a party is renamed.
CREATE OR REPLACE FUNCTION fn_party_sync_account_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND (NEW.name <> OLD.name OR NEW.name_ps <> OLD.name_ps) THEN
    UPDATE accounts SET name = NEW.name, name_ps = coalesce(NEW.name_ps, '')
     WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supplier_sync_account AFTER UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION fn_party_sync_account_name();
CREATE TRIGGER trg_warehouse_sync_account AFTER UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION fn_party_sync_account_name();
CREATE TRIGGER trg_saraf_sync_account AFTER UPDATE ON sarafs
  FOR EACH ROW EXECUTE FUNCTION fn_party_sync_account_name();

-- ---------------------------------------------------------------------------
-- RLS
--   products / product_variants: readable by every authenticated user
--     (warehouse screens need variant labels); writable by admin/office.
--   suppliers / sarafs: admin & office only.
--   warehouses: admin/office all rows; warehouse user sees own row only.
--   No DELETE policies anywhere — parties are deactivated, never deleted
--   (their ledger accounts and history must survive).
-- ---------------------------------------------------------------------------
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sarafs           ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY products_write  ON products FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY products_update ON products FOR UPDATE TO authenticated USING (app_is_office()) WITH CHECK (app_is_office());

CREATE POLICY variants_select ON product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY variants_write  ON product_variants FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY variants_update ON product_variants FOR UPDATE TO authenticated USING (app_is_office()) WITH CHECK (app_is_office());

CREATE POLICY suppliers_select ON suppliers FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY suppliers_update ON suppliers FOR UPDATE TO authenticated USING (app_is_office()) WITH CHECK (app_is_office());

CREATE POLICY warehouses_select ON warehouses FOR SELECT TO authenticated
  USING (app_is_office() OR id = app_current_warehouse());
CREATE POLICY warehouses_insert ON warehouses FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY warehouses_update ON warehouses FOR UPDATE TO authenticated USING (app_is_office()) WITH CHECK (app_is_office());

CREATE POLICY sarafs_select ON sarafs FOR SELECT TO authenticated USING (app_is_office());
CREATE POLICY sarafs_insert ON sarafs FOR INSERT TO authenticated WITH CHECK (app_is_office());
CREATE POLICY sarafs_update ON sarafs FOR UPDATE TO authenticated USING (app_is_office()) WITH CHECK (app_is_office());

GRANT SELECT, INSERT, UPDATE ON products, product_variants, suppliers, warehouses, sarafs TO authenticated;

-- audit + touch
SELECT fn_enable_audit(t), fn_enable_touch(t)
  FROM unnest(ARRAY['products', 'product_variants', 'suppliers', 'warehouses', 'sarafs']::regclass[]) AS t;
