import { NextResponse } from "next/server";
import { getAiConfig, getImageConfig } from "@/lib/ai-config";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({
    ...getAiConfig(),
    imageModel: getImageConfig().model,
  });
}
