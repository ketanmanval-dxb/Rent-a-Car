CREATE INDEX "damage_reports_agreement_idx" ON "damage_reports" USING btree ("rental_agreement_id");--> statement-breakpoint
CREATE INDEX "damage_reports_reported_by_idx" ON "damage_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_created_by_idx" ON "maintenance_blocks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rental_agreements_return_branch_idx" ON "rental_agreements" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_checked_out_by_idx" ON "rental_agreements" USING btree ("checked_out_by");--> statement-breakpoint
CREATE INDEX "rental_agreements_checked_in_by_idx" ON "rental_agreements" USING btree ("checked_in_by");--> statement-breakpoint
CREATE INDEX "reservations_return_branch_idx" ON "reservations" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "reservations_driver_profile_idx" ON "reservations" USING btree ("driver_profile_id");