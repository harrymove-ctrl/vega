CREATE TABLE `auth_nonces` (
	`address` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_address` text NOT NULL,
	`bot_id` text,
	`bot_name_snapshot` text DEFAULT '' NOT NULL,
	`market_scope_snapshot` text,
	`strategy_type_snapshot` text,
	`interval` text DEFAULT '1h' NOT NULL,
	`start_time` integer,
	`end_time` integer,
	`initial_capital_usd` real DEFAULT 0 NOT NULL,
	`execution_model` text DEFAULT 'standard' NOT NULL,
	`params` text,
	`rules_snapshot_json` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`result` text,
	`failure_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`owner_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bot_runtimes` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`owner_address` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`runtime_kind` text DEFAULT 'wallet-in-loop' NOT NULL,
	`mode` text DEFAULT 'live' NOT NULL,
	`risk_policy_json` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`stopped_at` text,
	`last_heartbeat` text,
	`summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_address` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`authoring_mode` text DEFAULT 'visual' NOT NULL,
	`strategy_type` text DEFAULT 'custom' NOT NULL,
	`market_scope` text DEFAULT '' NOT NULL,
	`rules_json` text,
	`rules_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `copies` (
	`id` text PRIMARY KEY NOT NULL,
	`source_bot_id` text NOT NULL,
	`source_runtime_id` text,
	`copier_address` text NOT NULL,
	`mode` text DEFAULT 'mirror' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`scale_bps` integer DEFAULT 10000 NOT NULL,
	`max_notional_usd` real,
	`settings` text,
	`confirmed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`source_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_runtime_id`) REFERENCES `bot_runtimes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`copier_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketplace_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`creator_address` text NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`access_note` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`access_mode` text DEFAULT 'open' NOT NULL,
	`publish_state` text DEFAULT 'draft' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`featured_rank` integer DEFAULT 0 NOT NULL,
	`collection_key` text,
	`stats` text,
	`invite_json` text,
	`published_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_address` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`rebalance_mode` text DEFAULT 'drift' NOT NULL,
	`rebalance_interval_minutes` integer DEFAULT 60 NOT NULL,
	`drift_threshold_pct` real DEFAULT 6 NOT NULL,
	`target_notional_usd` real DEFAULT 0 NOT NULL,
	`current_notional_usd` real DEFAULT 0 NOT NULL,
	`kill_switch_reason` text,
	`last_rebalanced_at` text,
	`legs` text,
	`risk_policy` text,
	`rebalance_history` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`runtime_id` text,
	`owner_address` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`stopped_at` text,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`unrealized_pnl` real DEFAULT 0 NOT NULL,
	`n_orders` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runtime_id`) REFERENCES `bot_runtimes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`telegram_username` text,
	`telegram_first_name` text,
	`chat_label` text,
	`connected` integer DEFAULT false NOT NULL,
	`notifications_enabled` integer DEFAULT false NOT NULL,
	`notification_prefs` text,
	`link_token` text,
	`link_expires_at` text,
	`connected_at` text,
	`last_interaction_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`wallet_address`) REFERENCES `users`(`wallet_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
