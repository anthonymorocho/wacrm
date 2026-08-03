import { NextResponse } from "next/server";
import { isSupportedLocale } from "@/i18n/locales";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { locale?: string } | null;
  if (!isSupportedLocale(body?.locale)) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }

  const response = NextResponse.json({ locale: body.locale });
  response.cookies.set("NEXT_LOCALE", body.locale, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return response;
}
