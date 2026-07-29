import { useRef, useState } from "react";
import { motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Telescope01Icon,
  MagicWand01Icon,
  GitPullRequestIcon,
  Bug01Icon,
} from "@hugeicons/core-free-icons";
import { type Project } from "@/api";
import { Logo } from "./Logo";
import { Composer, type ComposerLaunchBody } from "./Composer";

const SUGGESTIONS: { icon: typeof Bug01Icon; tint: string; label: string; prompt: string }[] = [
  {
    icon: Telescope01Icon,
    tint: "text-sky-400",
    label: "Explore the codebase",
    prompt: "Give me a map of this codebase: what it does, how it's structured, where the important pieces live.",
  },
  {
    icon: MagicWand01Icon,
    tint: "text-violet-400",
    label: "Build something new",
    prompt: "I want to build ",
  },
  {
    icon: GitPullRequestIcon,
    tint: "text-emerald-400",
    label: "Review my changes",
    prompt: "Review the current branch changes for bugs and cleanups, and report what you find.",
  },
  {
    icon: Bug01Icon,
    tint: "text-orange-400",
    label: "Fix something broken",
    prompt: "Something is broken: ",
  },
];

export function Home({
  projects,
  onLaunch,
  onProjectsChanged,
}: {
  projects: Project[];
  onLaunch: (body: ComposerLaunchBody) => Promise<void>;
  onProjectsChanged: () => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // on touch, autofocus would pop the virtual keyboard the instant Home loads —
  // jarring, and it hides the composer. Let the user tap in.
  const coarsePointer =
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  return (
    <div className="relative flex h-full flex-col items-center justify-center px-4 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex w-full max-w-2xl flex-col items-center"
      >
        <Logo className="size-10 text-foreground" />

        <h1 className="mt-5 text-center text-2xl font-medium tracking-tight sm:text-[28px]">
          What should we build?
        </h1>

        <div className="mt-8 w-full">
          <Composer
            projects={projects}
            onLaunch={onLaunch}
            onProjectsChanged={onProjectsChanged}
            text={text}
            onTextChange={setText}
            autoFocus={!coarsePointer}
            textareaRef={textareaRef}
          />
        </div>

        <div className="mt-5 flex max-w-full flex-wrap justify-center gap-2 pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setText(s.prompt);
                textareaRef.current?.focus();
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/40 px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent sm:py-1.5 sm:text-xs"
            >
              <HugeiconsIcon icon={s.icon} size={13} className={s.tint} />
              {s.label}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
