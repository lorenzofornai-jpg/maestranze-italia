CREATE TYPE "public"."discipline" AS ENUM('FOOD', 'BEVERAGE', 'TAILORING', 'SPORT', 'CRAFTS');--> statement-breakpoint
CREATE TYPE "public"."maison_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."product_unit" AS ENUM('PIECE', 'KG', 'BOTTLE', 'CASE', 'METRE', 'SET');--> statement-breakpoint
CREATE TABLE "maisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"discipline" "discipline" NOT NULL,
	"tagline" jsonb NOT NULL,
	"story" jsonb NOT NULL,
	"craft" jsonb,
	"founded_year" integer,
	"region" text NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"b2b_min_order_cents" integer,
	"lead_time_days" integer,
	"cover_image" text,
	"commission_bps" integer DEFAULT 1000 NOT NULL,
	"status" "maison_status" DEFAULT 'DRAFT' NOT NULL,
	"review_note" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maison_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"b2b_price_cents" integer,
	"unit" "product_unit" DEFAULT 'PIECE' NOT NULL,
	"min_qty" integer DEFAULT 1 NOT NULL,
	"stock" integer,
	"made_to_order" boolean DEFAULT false NOT NULL,
	"image" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maisons" ADD CONSTRAINT "maisons_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_maison_id_maisons_id_fk" FOREIGN KEY ("maison_id") REFERENCES "public"."maisons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maisons_slug_uq" ON "maisons" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "maisons_account_uq" ON "maisons" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "maisons_territory_idx" ON "maisons" USING btree ("status","region","province");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uq" ON "products" USING btree ("maison_id","slug");--> statement-breakpoint
CREATE INDEX "products_maison_idx" ON "products" USING btree ("maison_id","position");