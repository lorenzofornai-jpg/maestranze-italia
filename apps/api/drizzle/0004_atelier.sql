CREATE TYPE "public"."commission_status" AS ENUM('REQUESTED', 'IN_DIALOGUE', 'PROPOSED', 'AGREED', 'IN_WORK', 'BALANCE_DUE', 'DECLINED', 'EXPIRED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "commission_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL,
	"author" text NOT NULL,
	"author_account_id" uuid,
	"kind" text NOT NULL,
	"body" text,
	"language" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachment" text,
	"dictated" boolean DEFAULT false NOT NULL,
	"contact_flag" boolean DEFAULT false NOT NULL,
	"event" text,
	"event_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"description" text NOT NULL,
	"language" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"deposit_pct" integer NOT NULL,
	"deposit_cents" integer NOT NULL,
	"lead_time_weeks" integer NOT NULL,
	"fittings" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"buyer_account_id" uuid NOT NULL,
	"maison_id" uuid NOT NULL,
	"status" "commission_status" DEFAULT 'REQUESTED' NOT NULL,
	"language" text NOT NULL,
	"brief" jsonb NOT NULL,
	"brief_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measurements" jsonb,
	"measurements_consent_at" timestamp with time zone,
	"respond_by" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"delivery_address" jsonb,
	"deposit_order_id" uuid,
	"balance_order_id" uuid,
	"work_started_at" timestamp with time zone,
	"buyer_read_at" timestamp with time zone,
	"maker_read_at" timestamp with time zone,
	"buyer_notified_at" timestamp with time zone,
	"maker_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maisons" ADD COLUMN "accepts_commissions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "commission_messages" ADD CONSTRAINT "commission_messages_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_proposals" ADD CONSTRAINT "commission_proposals_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_buyer_account_id_accounts_id_fk" FOREIGN KEY ("buyer_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_maison_id_maisons_id_fk" FOREIGN KEY ("maison_id") REFERENCES "public"."maisons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_messages_idx" ON "commission_messages" USING btree ("commission_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_proposals_version_uq" ON "commission_proposals" USING btree ("commission_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "commissions_number_uq" ON "commissions" USING btree ("number");--> statement-breakpoint
CREATE INDEX "commissions_buyer_idx" ON "commissions" USING btree ("buyer_account_id","updated_at");--> statement-breakpoint
CREATE INDEX "commissions_maison_idx" ON "commissions" USING btree ("maison_id","updated_at");--> statement-breakpoint
CREATE INDEX "commissions_status_idx" ON "commissions" USING btree ("status","respond_by");