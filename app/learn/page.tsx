import { redirect } from "next/navigation";

import { LearningWorkspace } from "@/components/chat/chat-workspace";
import { getCurrentUser } from "@/lib/auth";
import { getUserSettings, sanitizeViewerUser } from "@/lib/server-data";

export default async function LearnPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const initialSettings = await getUserSettings(user.id);

  return <LearningWorkspace initialUser={sanitizeViewerUser(user)} initialSettings={initialSettings} />;
}
