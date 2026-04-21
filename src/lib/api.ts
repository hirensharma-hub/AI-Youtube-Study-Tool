import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 })
    };
  }

  return {
    user,
    response: null
  };
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("The request payload was invalid. Refresh the page and try again.");
  }
}
