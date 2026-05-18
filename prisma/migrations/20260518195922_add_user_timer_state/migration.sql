-- CreateTable
CREATE TABLE "user_timer_states" (
    "user_id" TEXT NOT NULL,
    "session_type" TEXT NOT NULL DEFAULT 'work',
    "started_at" TIMESTAMP(3),
    "seconds_left" INTEGER NOT NULL DEFAULT 1500,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "total_focus_minutes" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_timer_states_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_timer_states" ADD CONSTRAINT "user_timer_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
