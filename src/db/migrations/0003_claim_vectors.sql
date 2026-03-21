CREATE TABLE IF NOT EXISTS `claim_vectors` (
  `id` text PRIMARY KEY NOT NULL,
  `claim_text` text NOT NULL,
  `claim_text_normalized` text NOT NULL,
  `embedding` text NOT NULL,
  `verdict` text NOT NULL,
  `confidence` text NOT NULL,
  `explanation` text NOT NULL,
  `evidence` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `verification_count` integer DEFAULT 0
);
