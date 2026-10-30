ALTER TABLE "rental_agreements" DROP CONSTRAINT "rental_agreements_pickup_fuel_range";--> statement-breakpoint
ALTER TABLE "rental_agreements" DROP CONSTRAINT "rental_agreements_return_fuel_range";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_pickup_fuel_range" CHECK ("rental_agreements"."pickup_fuel_level" BETWEEN 0 AND 8);--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_fuel_range" CHECK ("rental_agreements"."return_fuel_level" IS NULL OR "rental_agreements"."return_fuel_level" BETWEEN 0 AND 8);