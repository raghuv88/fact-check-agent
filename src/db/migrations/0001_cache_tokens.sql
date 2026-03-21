ALTER TABLE `verified_claims_cache` ADD COLUMN `explanation` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `verified_claims_cache` ADD COLUMN `tokens_per_verification` integer NOT NULL DEFAULT 0;
