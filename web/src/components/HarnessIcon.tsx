import { HugeiconsIcon } from "@hugeicons/react";
import { TerminalIcon } from "@hugeicons/core-free-icons";
import claudeSvg from "@/assets/brands/claude.svg?raw";
import codexSvg from "@/assets/brands/codex.svg?raw";
import geminiSvg from "@/assets/brands/gemini.svg?raw";
import opencodeSvg from "@/assets/brands/opencode.svg?raw";
import { cn } from "@/lib/utils";

/** Official brand marks (svgl.app), embedded inline. Shell keeps a glyph. */
const BRAND_SVGS: Record<string, string> = {
  claude: claudeSvg,
  codex: codexSvg,
  gemini: geminiSvg,
  opencode: opencodeSvg,
};

export function HarnessIcon({
  harness,
  size = 16,
  className,
}: {
  harness: string;
  size?: number;
  className?: string;
}) {
  const svg = BRAND_SVGS[harness];
  if (!svg) {
    return <HugeiconsIcon icon={TerminalIcon} size={size} strokeWidth={1.8} className={className} />;
  }
  return (
    <span
      className={cn("inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-full", className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
