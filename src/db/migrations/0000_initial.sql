CREATE TABLE IF NOT EXISTS `fact_check_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` text NOT NULL,
  `article_text` text NOT NULL,
  `total_tokens` integer DEFAULT 0,
  `total_cost_usd` real DEFAULT 0,
  `total_duration_ms` integer DEFAULT 0,
  `status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `token_usage` (
  `id` text PRIMARY KEY NOT NULL,
  `timestamp` text NOT NULL,
  `request_id` text NOT NULL,
  `agent_type` text NOT NULL,
  `step_number` integer NOT NULL,
  `step_name` text NOT NULL,
  `model` text NOT NULL,
  `input_tokens` integer NOT NULL,
  `output_tokens` integer NOT NULL,
  `cost_usd` real NOT NULL,
  `duration_ms` integer NOT NULL,
  `cache_hit` integer DEFAULT false,
  FOREIGN KEY (`request_id`) REFERENCES `fact_check_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verified_claims_cache` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_text` text NOT NULL,
  `claim_hash` text NOT NULL,
  `verdict` text NOT NULL,
  `confidence` text NOT NULL,
  `evidence` text NOT NULL,
  `verified_at` text NOT NULL,
  `verification_count` integer DEFAULT 1,
  `token_savings` integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `verified_claims_cache_claim_hash_unique` ON `verified_claims_cache` (`claim_hash`);
