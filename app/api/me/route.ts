import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api";
import { getUserSettings } from "@/lib/server-data";

export async function GET() {
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  return NextResponse.json({
    user,
    settings: await getUserSettings(user.id)
  });
}
