-- btree_gist provides GiST operator classes for uuid equality (needed by the
-- vehicle_id + period GiST indexes and the vehicle_occupancy exclusion constraint).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_stage" AS ENUM('PICKUP', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'HELD', 'RELEASED', 'CAPTURED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."extra_pricing_type" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('RENTAL', 'MODIFICATION', 'LATE_RETURN', 'DAMAGE', 'FUEL');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_kind" AS ENUM('SEASONAL', 'WEEKEND', 'DURATION_DISCOUNT', 'ONE_WAY_FEE');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text,
	"licence_number" text NOT NULL,
	"licence_country" text NOT NULL,
	"licence_expiry" date NOT NULL,
	"licence_file_key" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_phone_format" CHECK ("driver_profiles"."phone" ~ '^\+?[0-9 ()-]{7,20}$'),
	CONSTRAINT "driver_profiles_licence_after_dob" CHECK ("driver_profiles"."licence_expiry" > "driver_profiles"."date_of_birth"),
	CONSTRAINT "driver_profiles_licence_number_not_blank" CHECK (length(btrim("driver_profiles"."licence_number")) > 0),
	CONSTRAINT "driver_profiles_licence_key_scope" CHECK ("driver_profiles"."licence_file_key" IS NULL OR "driver_profiles"."licence_file_key" LIKE 'licences/%')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_format" CHECK ("users"."email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "users_name_not_blank" CHECK (length(btrim("users"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"emirate" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"timezone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"opening_hours" text DEFAULT 'Daily 08:00-22:00' NOT NULL,
	"location_fee_minor" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_format" CHECK ("branches"."code" ~ '^[A-Z0-9-]{2,12}$'),
	CONSTRAINT "branches_timezone_format" CHECK ("branches"."timezone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$|^UTC$'),
	CONSTRAINT "branches_location_fee_nonneg" CHECK ("branches"."location_fee_minor" >= 0),
	CONSTRAINT "branches_lat_range" CHECK ("branches"."latitude" IS NULL OR "branches"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "branches_lng_range" CHECK ("branches"."longitude" IS NULL OR "branches"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pricing_type" "extra_pricing_type" NOT NULL,
	"price_minor" integer NOT NULL,
	"max_total_minor" integer,
	"max_quantity" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_nonneg" CHECK ("extras"."price_minor" >= 0),
	CONSTRAINT "extras_max_total_pos" CHECK ("extras"."max_total_minor" IS NULL OR "extras"."max_total_minor" > 0),
	CONSTRAINT "extras_max_qty_range" CHECK ("extras"."max_quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "pricing_rule_kind" NOT NULL,
	"category_id" uuid,
	"branch_id" uuid,
	"from_branch_id" uuid,
	"to_branch_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"min_days" integer,
	"adjustment_bps" integer,
	"amount_minor" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_bps_range" CHECK ("pricing_rules"."adjustment_bps" IS NULL OR "pricing_rules"."adjustment_bps" BETWEEN -9000 AND 50000),
	CONSTRAINT "pricing_rules_amount_nonneg" CHECK ("pricing_rules"."amount_minor" IS NULL OR "pricing_rules"."amount_minor" >= 0),
	CONSTRAINT "pricing_rules_shape" CHECK (CASE "pricing_rules"."kind"
        WHEN 'SEASONAL' THEN "pricing_rules"."valid_from" IS NOT NULL AND "pricing_rules"."valid_to" IS NOT NULL AND "pricing_rules"."valid_to" >= "pricing_rules"."valid_from" AND "pricing_rules"."adjustment_bps" IS NOT NULL
        WHEN 'WEEKEND' THEN "pricing_rules"."adjustment_bps" IS NOT NULL
        WHEN 'DURATION_DISCOUNT' THEN "pricing_rules"."min_days" IS NOT NULL AND "pricing_rules"."min_days" >= 1 AND "pricing_rules"."adjustment_bps" IS NOT NULL
        WHEN 'ONE_WAY_FEE' THEN "pricing_rules"."from_branch_id" IS NOT NULL AND "pricing_rules"."to_branch_id" IS NOT NULL AND "pricing_rules"."from_branch_id" <> "pricing_rules"."to_branch_id" AND "pricing_rules"."amount_minor" IS NOT NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"daily_rate_minor" integer NOT NULL,
	"deposit_minor" integer NOT NULL,
	"late_fee_per_hour_minor" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicle_categories_daily_rate_pos" CHECK ("vehicle_categories"."daily_rate_minor" > 0),
	CONSTRAINT "vehicle_categories_deposit_nonneg" CHECK ("vehicle_categories"."deposit_minor" >= 0),
	CONSTRAINT "vehicle_categories_late_fee_nonneg" CHECK ("vehicle_categories"."late_fee_per_hour_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	CONSTRAINT "vehicle_feature_map_vehicle_id_feature_id_pk" PRIMARY KEY("vehicle_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint NOT NULL,
	"plate_number" text NOT NULL,
	"vin" text NOT NULL,
	"color" text NOT NULL,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" smallint NOT NULL,
	"doors" smallint NOT NULL,
	"luggage" smallint NOT NULL,
	"daily_rate_minor" integer,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_number_unique" UNIQUE("plate_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_vin_format" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$'),
	CONSTRAINT "vehicles_plate_not_blank" CHECK (length(btrim("vehicles"."plate_number")) > 0),
	CONSTRAINT "vehicles_year_range" CHECK ("vehicles"."year" BETWEEN 1990 AND 2100),
	CONSTRAINT "vehicles_seats_range" CHECK ("vehicles"."seats" BETWEEN 1 AND 60),
	CONSTRAINT "vehicles_doors_range" CHECK ("vehicles"."doors" BETWEEN 0 AND 10),
	CONSTRAINT "vehicles_luggage_range" CHECK ("vehicles"."luggage" BETWEEN 0 AND 30),
	CONSTRAINT "vehicles_daily_rate_pos" CHECK ("vehicles"."daily_rate_minor" IS NULL OR "vehicles"."daily_rate_minor" > 0),
	CONSTRAINT "vehicles_mileage_nonneg" CHECK ("vehicles"."mileage_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"rental_agreement_id" uuid,
	"reported_by" uuid,
	"stage" "damage_stage" NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"description" text NOT NULL,
	"image_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"estimated_cost_minor" integer DEFAULT 0 NOT NULL,
	"charged_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_description_not_blank" CHECK (length(btrim("damage_reports"."description")) > 0),
	CONSTRAINT "damage_reports_money_nonneg" CHECK ("damage_reports"."estimated_cost_minor" >= 0 AND "damage_reports"."charged_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_deposit_id" text,
	"idempotency_key" text NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"amount_minor" integer NOT NULL,
	"captured_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_provider_deposit_id_unique" UNIQUE("provider_deposit_id"),
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_pos" CHECK ("deposits"."amount_minor" > 0),
	CONSTRAINT "deposits_capture_range" CHECK ("deposits"."captured_minor" >= 0 AND "deposits"."captured_minor" <= "deposits"."amount_minor"),
	CONSTRAINT "deposits_currency" CHECK ("deposits"."currency" = 'AED')
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"status" "maintenance_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_period_valid" CHECK ("maintenance_blocks"."ends_at" > "maintenance_blocks"."starts_at"),
	CONSTRAINT "maintenance_blocks_reason_not_blank" CHECK (length(btrim("maintenance_blocks"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'RENTAL' NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_minor" integer NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_pos" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_refund_range" CHECK ("payments"."refunded_minor" >= 0 AND "payments"."refunded_minor" <= "payments"."amount_minor"),
	CONSTRAINT "payments_currency" CHECK ("payments"."currency" = 'AED')
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"checked_out_at" timestamp with time zone NOT NULL,
	"checked_out_by" uuid,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_level" smallint NOT NULL,
	"pickup_notes" text,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	"return_branch_id" uuid,
	"return_mileage_km" integer,
	"return_fuel_level" smallint,
	"return_notes" text,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"late_fee_minor" integer DEFAULT 0 NOT NULL,
	"fuel_charge_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_pickup_fuel_range" CHECK ("rental_agreements"."pickup_fuel_level" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_return_fuel_range" CHECK ("rental_agreements"."return_fuel_level" IS NULL OR "rental_agreements"."return_fuel_level" BETWEEN 0 AND 100),
	CONSTRAINT "rental_agreements_pickup_mileage_nonneg" CHECK ("rental_agreements"."pickup_mileage_km" >= 0),
	CONSTRAINT "rental_agreements_return_mileage_gte" CHECK ("rental_agreements"."return_mileage_km" IS NULL OR "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"),
	CONSTRAINT "rental_agreements_checkin_after_checkout" CHECK ("rental_agreements"."checked_in_at" IS NULL OR "rental_agreements"."checked_in_at" >= "rental_agreements"."checked_out_at"),
	CONSTRAINT "rental_agreements_checkin_complete" CHECK ("rental_agreements"."checked_in_at" IS NULL OR ("rental_agreements"."return_mileage_km" IS NOT NULL AND "rental_agreements"."return_fuel_level" IS NOT NULL AND "rental_agreements"."return_branch_id" IS NOT NULL)),
	CONSTRAINT "rental_agreements_money_nonneg" CHECK ("rental_agreements"."late_minutes" >= 0 AND "rental_agreements"."late_fee_minor" >= 0 AND "rental_agreements"."fuel_charge_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"pricing_type" "extra_pricing_type" NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_extras_qty_pos" CHECK ("reservation_extras"."quantity" >= 1),
	CONSTRAINT "reservation_extras_money_nonneg" CHECK ("reservation_extras"."unit_price_minor" >= 0 AND "reservation_extras"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"driver_profile_id" uuid,
	"pickup_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(pickup_at, return_at, '[)')) STORED NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"idempotency_key" text,
	"currency" text DEFAULT 'AED' NOT NULL,
	"rental_days" integer NOT NULL,
	"daily_rate_minor" integer NOT NULL,
	"rental_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"extras_minor" integer DEFAULT 0 NOT NULL,
	"one_way_fee_minor" integer DEFAULT 0 NOT NULL,
	"location_fee_minor" integer DEFAULT 0 NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"deposit_minor" integer NOT NULL,
	"late_fee_minor" integer DEFAULT 0 NOT NULL,
	"cancellation_fee_minor" integer DEFAULT 0 NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"pricing_breakdown" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "reservations_period_valid" CHECK ("reservations"."return_at" > "reservations"."pickup_at"),
	CONSTRAINT "reservations_max_length" CHECK ("reservations"."return_at" - "reservations"."pickup_at" <= interval '90 days'),
	CONSTRAINT "reservations_hold_when_pending" CHECK ("reservations"."status" <> 'PENDING' OR "reservations"."hold_expires_at" IS NOT NULL),
	CONSTRAINT "reservations_currency" CHECK ("reservations"."currency" = 'AED'),
	CONSTRAINT "reservations_days_pos" CHECK ("reservations"."rental_days" >= 1),
	CONSTRAINT "reservations_money_nonneg" CHECK ("reservations"."daily_rate_minor" >= 0 AND "reservations"."rental_minor" >= 0 AND "reservations"."discount_minor" >= 0 AND "reservations"."extras_minor" >= 0
        AND "reservations"."one_way_fee_minor" >= 0 AND "reservations"."location_fee_minor" >= 0 AND "reservations"."subtotal_minor" >= 0 AND "reservations"."vat_minor" >= 0
        AND "reservations"."deposit_minor" >= 0 AND "reservations"."late_fee_minor" >= 0 AND "reservations"."cancellation_fee_minor" >= 0 AND "reservations"."refunded_minor" >= 0),
	CONSTRAINT "reservations_subtotal_sum" CHECK ("reservations"."subtotal_minor" = "reservations"."rental_minor" - "reservations"."discount_minor" + "reservations"."extras_minor" + "reservations"."one_way_fee_minor" + "reservations"."location_fee_minor"),
	CONSTRAINT "reservations_total_sum" CHECK ("reservations"."total_minor" = "reservations"."subtotal_minor" + "reservations"."vat_minor"),
	CONSTRAINT "reservations_reference_format" CHECK ("reservations"."reference" ~ '^DE-[A-Z0-9]{6,10}$')
);
--> statement-breakpoint
CREATE TABLE "vehicle_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reservation_id" uuid,
	"maintenance_block_id" uuid,
	CONSTRAINT "vehicle_occupancy_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "vehicle_occupancy_maintenance_block_id_unique" UNIQUE("maintenance_block_id"),
	CONSTRAINT "vehicle_occupancy_one_source" CHECK (num_nonnulls("vehicle_occupancy"."reservation_id", "vehicle_occupancy"."maintenance_block_id") = 1),
	CONSTRAINT "vehicle_occupancy_period_bounded" CHECK (NOT isempty("vehicle_occupancy"."period") AND NOT lower_inf("vehicle_occupancy"."period") AND NOT upper_inf("vehicle_occupancy"."period"))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_rental_agreement_id_rental_agreements_id_fk" FOREIGN KEY ("rental_agreement_id") REFERENCES "public"."rental_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_maintenance_block_id_maintenance_blocks_id_fk" FOREIGN KEY ("maintenance_block_id") REFERENCES "public"."maintenance_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "pricing_rules_kind_active_idx" ON "pricing_rules" USING btree ("kind","is_active");--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_status_idx" ON "vehicles" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_idx" ON "damage_reports" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_period_gist" ON "maintenance_blocks" USING gist ("vehicle_id","period");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_vehicle_idx" ON "rental_agreements" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_extras_res_extra_uq" ON "reservation_extras" USING btree ("reservation_id","extra_id");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "reservations_status_hold_idx" ON "reservations" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "reservations_pickup_branch_idx" ON "reservations" USING btree ("pickup_branch_id","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_period_gist" ON "reservations" USING gist ("vehicle_id","period");