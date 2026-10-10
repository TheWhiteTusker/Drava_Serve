CREATE TABLE "job_run" (
	"job" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb,
	CONSTRAINT "job_run_job_scope_key_pk" PRIMARY KEY("job","scope","key")
);
--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_indentId_unique" UNIQUE("indent_id");