DROP INDEX "payment_webhooks_provider_unique";--> statement-breakpoint
DROP INDEX "payments_provider_unique";--> statement-breakpoint
ALTER TABLE "payment_webhooks" ADD COLUMN "provider" text DEFAULT 'yookassa' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_webhooks" ALTER COLUMN "provider" SET DEFAULT 'tbank';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" text DEFAULT 'yookassa' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'tbank';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhooks_provider_unique" ON "payment_webhooks" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_unique" ON "payments" USING btree ("provider","provider_payment_id");
