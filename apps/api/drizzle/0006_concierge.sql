CREATE TABLE "concierge_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"locale" text DEFAULT 'it' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"drafts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concierge_sessions" ADD CONSTRAINT "concierge_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concierge_sessions_account_idx" ON "concierge_sessions" USING btree ("account_id");