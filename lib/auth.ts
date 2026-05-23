import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";

import { getDatabase } from "@/lib/mongodb";
import { env } from "@/lib/env";

const SESSION_COOKIE = "turbo_cloud_chat_session";
const encoder = new TextEncoder();

interface SessionPayload {
  sub: string;
  email: string;
}

function getSessionSecret() {
  return encoder.encode(env.sessionSecret);
}

export async function createSession(userId: string, email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSessionSecret());
}

export async function persistSession(token: string) {
  cookies().set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearSession() {
  cookies().set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) {
    return null;
  }

  try {
    const verified = await jwtVerify(cookie, getSessionSecret());
    return {
      sub: verified.payload.sub ?? "",
      email: String(verified.payload.email ?? "")
    };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const session = await readSession();
  if (!session?.sub || !ObjectId.isValid(session.sub)) {
    return null;
  }

  const db = await getDatabase();
  const user = await db.collection("users").findOne({
    _id: new ObjectId(session.sub)
  });

  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    email: String(user.email),
    name: String(user.name)
  };
}
