CREATE TABLE "call_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL,
	"proposed_by" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"buyer_time_zone" text,
	"maker_time_zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL,
	"started_by" text NOT NULL,
	"status" text DEFAULT 'RINGING' NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"buyer_seen_at" timestamp with time zone,
	"maker_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_signals" ADD CONSTRAINT "call_signals_call_id_commission_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."commission_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_appointments" ADD CONSTRAINT "commission_appointments_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_calls" ADD CONSTRAINT "commission_calls_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_signals_idx" ON "call_signals" USING btree ("call_id","id");--> statement-breakpoint
CREATE INDEX "commission_appointments_idx" ON "commission_appointments" USING btree ("commission_id","starts_at");--> statement-breakpoint
CREATE INDEX "commission_calls_idx" ON "commission_calls" USING btree ("commission_id","created_at");