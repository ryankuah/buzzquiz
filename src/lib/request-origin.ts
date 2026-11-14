import { NextResponse } from "next/server";

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (
      new URL(origin).host ===
      (request.headers.get("host") || new URL(request.url).host)
    )
      return null;
  } catch {
    /* Invalid and cross-site origins use the same rejection. */
  }
  return NextResponse.json(
    { error: "Open this quiz from this app." },
    { status: 403 },
  );
}
