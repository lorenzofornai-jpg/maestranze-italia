CREATE TYPE "public"."account_role" AS ENUM('BUYER', 'MAKER');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('PENDING_EMAIL', 'PENDING_MFA', 'ACTIVE', 'LOCKED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."challenge_stage" AS ENUM('PASSWORD_OK', 'COMPLETED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('WEB', 'MOBILE');--> statement-breakpoint
CREATE TYPE "public"."email_token_purpose" AS ENUM('ACTIVATION', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."mfa_method" AS ENUM('SMS', 'TOTP', 'MOBILE_APP');--> statement-breakpoint
CREATE TYPE "public"."push_status" AS ENUM('NONE', 'PENDING', 'APPROVED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('PERSON', 'COMPANY');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "account_role" NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"status" "account_status" DEFAULT 'PENDING_EMAIL' NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"phone" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"company_name" text,
	"vat_number" text,
	"fiscal_code" text,
	"sector" text NOT NULL,
	"province" text NOT NULL,
	"city" text NOT NULL,
	"locale" text DEFAULT 'it' NOT NULL,
	"consents" jsonb NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"type" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'LOGIN' NOT NULL,
	"details" jsonb,
	"channel" "channel" NOT NULL,
	"enrollment" boolean DEFAULT false NOT NULL,
	"stage" "challenge_stage" DEFAULT 'PASSWORD_OK' NOT NULL,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_sent_count" integer DEFAULT 0 NOT NULL,
	"otp_last_sent_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"push_status" "push_status" DEFAULT 'NONE' NOT NULL,
	"push_nonce" text,
	"push_device_id" uuid,
	"ip" text,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"public_key" text NOT NULL,
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "email_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"method" "mfa_method" NOT NULL,
	"totp_secret_enc" text,
	"totp_last_step" integer,
	"device_id" uuid,
	"confirmed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"channel" "channel" NOT NULL,
	"mfa_method" "mfa_method" NOT NULL,
	"device_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_push_device_id_devices_id_fk" FOREIGN KEY ("push_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_nonces" ADD CONSTRAINT "device_nonces_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_uq" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_events_account_idx" ON "audit_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_token_uq" ON "auth_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_account_idx" ON "auth_challenges" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_code_uq" ON "device_pairings" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "devices_account_idx" ON "devices" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_hash_uq" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mfa_factors_account_idx" ON "mfa_factors" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");