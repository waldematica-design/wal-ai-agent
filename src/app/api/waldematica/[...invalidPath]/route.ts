import { NextResponse } from "next/server";

function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function GET() {
  return notFound();
}

export function POST() {
  return notFound();
}

export function OPTIONS() {
  return notFound();
}
