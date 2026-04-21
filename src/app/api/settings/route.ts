import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { getUserSettings, saveUserSettings } from "@/lib/server-data";

const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(100).max(4000).optional()
});

export async function GET() {
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  return NextResponse.json({
    settings: await getUserSettings(user.id)
  });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  let body: unknown;

  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The request payload was invalid.", 400);
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Invalid settings payload.");
  }
  const settings = await saveUserSettings(user.id, parsed.data);

  return NextResponse.json({
    settings
  });
}
