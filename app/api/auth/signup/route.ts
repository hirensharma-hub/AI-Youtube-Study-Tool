import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody } from "@/lib/api";
import { createSession, persistSession } from "@/lib/auth";
import { createUserAccount, findUserByEmail } from "@/lib/server-data";
import { hashPassword } from "@/lib/security/password";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(100)
});

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await parseJsonBody(request);
    } catch (error) {
      return apiError(error instanceof Error ? error.message : "The request payload was invalid.", 400);
    }

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Please provide a valid name, email, and password.");
    }

    const existing = await findUserByEmail(parsed.data.email);
    if (existing) {
      return apiError("An account with that email already exists.", 409);
    }

    const user = await createUserAccount({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password)
    });

    const token = await createSession(user.id, user.email);
    await persistSession(token);

    return NextResponse.json({ user });
  } catch (error) {
    return apiError(
      error instanceof Error
        ? error.message
        : "Unable to create your account right now. Check the server configuration and try again.",
      500
    );
  }
}
