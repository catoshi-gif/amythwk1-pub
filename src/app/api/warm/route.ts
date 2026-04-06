// src/app/api/warm/route.ts
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
