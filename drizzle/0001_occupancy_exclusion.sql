-- No-overlap guarantee across reservations AND maintenance blocks.
--
-- Design: a single trigger-maintained table, vehicle_occupancy, holds one row per
-- reservation in an active status (PENDING, CONFIRMED, PICKED_UP) and one row per
-- maintenance block that is not CANCELLED. Its exclusion constraint forbids two
-- rows for the same vehicle whose half-open [start, end) periods overlap. Because
-- the mirror rows are written by AFTER triggers inside the same statement/transaction
-- as the source row, every write path (app code, admin SQL, seed scripts) is
-- covered: an overlapping reservation or maintenance block fails with SQLSTATE
-- 23P01 (exclusion_violation) and the whole transaction rolls back.
-- Back-to-back periods ([10:00,12:00) and [12:00,14:00)) do not overlap.
--
-- Expired PENDING holds keep occupying until flipped to EXPIRED (cron job or the
-- reservation transaction), because constraints cannot depend on now().

ALTER TABLE "vehicle_occupancy"
  ADD CONSTRAINT "vehicle_occupancy_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION driveeasy_sync_reservation_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM vehicle_occupancy WHERE reservation_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    INSERT INTO vehicle_occupancy (vehicle_id, period, reservation_id)
    VALUES (NEW.vehicle_id, NEW.period, NEW.id)
    ON CONFLICT (reservation_id)
      DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
      WHERE vehicle_occupancy.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
         OR vehicle_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_occupancy WHERE reservation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION driveeasy_sync_maintenance_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM vehicle_occupancy WHERE maintenance_block_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status <> 'CANCELLED' THEN
    INSERT INTO vehicle_occupancy (vehicle_id, period, maintenance_block_id)
    VALUES (NEW.vehicle_id, NEW.period, NEW.id)
    ON CONFLICT (maintenance_block_id)
      DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
      WHERE vehicle_occupancy.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
         OR vehicle_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_occupancy WHERE maintenance_block_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER reservations_occupancy_sync
  AFTER INSERT OR UPDATE OF status, vehicle_id, pickup_at, return_at OR DELETE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_reservation_occupancy();
--> statement-breakpoint

CREATE TRIGGER maintenance_blocks_occupancy_sync
  AFTER INSERT OR UPDATE OF status, vehicle_id, starts_at, ends_at OR DELETE ON "maintenance_blocks"
  FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_maintenance_occupancy();
--> statement-breakpoint

-- Keep updated_at honest for tables the app updates.
CREATE OR REPLACE FUNCTION driveeasy_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'driver_profiles', 'branches', 'vehicle_categories', 'vehicles', 'pricing_rules', 'extras',
    'reservations', 'payments', 'deposits', 'rental_agreements', 'damage_reports', 'maintenance_blocks'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION driveeasy_touch_updated_at()',
                   t || '_touch_updated_at', t);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Audit log rows are append-only (except ON DELETE SET NULL of the actor FK).
CREATE OR REPLACE FUNCTION driveeasy_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_user_id IS NULL
     AND (NEW.id, NEW.action, NEW.entity_type, NEW.entity_id, NEW.data, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.action, OLD.entity_type, OLD.entity_id, OLD.data, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION driveeasy_audit_logs_append_only();
