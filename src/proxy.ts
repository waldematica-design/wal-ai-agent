import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

function hasMalformedBackslash(request: NextRequest) {
  const rawUrl = request.url.toLowerCase();

  return (
    rawUrl.includes("%5c") ||
    request.nextUrl.pathname.includes("\\")
  );
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/waldematica/")) {
    if (hasMalformedBackslash(request)) {
      return new NextResponse("Not Found", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/waldematica/:path*",
  ],
};
