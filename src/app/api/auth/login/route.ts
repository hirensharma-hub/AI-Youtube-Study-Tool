import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody } from "@/lib/api";
import { createSession, persistSession } from "@/lib/auth";
import { findUserByEmail } from "@/lib/server-data";
import { verifyPassword } from "@/lib/security/password";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(100)
});

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The request payload was invalid.", 400);
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please provide a valid email and password.");
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!user?.passwordHash) {
    return apiError("Invalid email or password.", 401);
  }

  const isValid = await verifyPassword(parsed.data.password, String(user.passwordHash));
  if (!isValid) {
    return apiError("Invalid email or password.", 401);
  }

  const sessionToken = await createSession(user._id.toString(), String(user.email));
  await persistSession(sessionToken);

  return NextResponse.json({
    user: {
      id: user._id.toString(),
      email: String(user.email),
      name: String(user.name)
    }
  });
}
