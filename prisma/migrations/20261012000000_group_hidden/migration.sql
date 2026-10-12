-- Hidden groups: an empty value means the group is visible, so every existing group stays visible.
ALTER TABLE "Group" ADD COLUMN "hiddenAt" TIMESTAMP(3);
