import { cn } from "@/lib/utils";
import logoUrl from "../logo-source.svg?raw";

/** Martin's mark, recolored via currentColor. */
export function Logo({ className }: { className?: string }) {
  const svg = logoUrl.replace(/fill="#202020"/g, 'fill="currentColor"');
  return (
    <span
      className={cn("inline-block [&>svg]:h-full [&>svg]:w-full", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
