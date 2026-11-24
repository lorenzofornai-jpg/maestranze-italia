ALTER TABLE "maisons" ADD COLUMN "search_vector" "tsvector";--> statement-breakpoint
CREATE INDEX "maisons_search_idx" ON "maisons" USING gin ("search_vector");