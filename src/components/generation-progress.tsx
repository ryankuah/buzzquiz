import { Check } from "lucide-react";
import {
  generationSteps,
  type GenerationSteps,
} from "@/lib/generation-response";

export default function GenerationProgress({
  steps,
}: {
  steps: GenerationSteps;
}) {
  const completed = generationSteps.filter(
    ({ id }) => steps[id] === "complete" || steps[id] === "reused",
  ).length;
  const current = generationSteps.find(({ id }) => steps[id] === "active");
  const progressText = `${completed} of ${generationSteps.length} steps complete`;

  return (
    <section className="generation-progress" aria-label="Creating your quiz">
      <div className="generation-progress-heading">
        <span>Creating your quiz</span>
        <span>
          {completed} / {generationSteps.length}
        </span>
      </div>
      <div
        className="generation-progress-track"
        role="progressbar"
        aria-label="Quiz generation"
        aria-valuemin={0}
        aria-valuemax={generationSteps.length}
        aria-valuenow={completed}
        aria-valuetext={`${progressText}. ${current?.label ?? "Ready"}.`}
      >
        <div
          style={{ width: `${(completed / generationSteps.length) * 100}%` }}
        />
      </div>
      <p className="sr-only" role="status">
        {progressText}. {current?.label}.
      </p>
      <ol className="generation-steps">
        {generationSteps.map(({ id, label }, index) => {
          const status = steps[id] ?? "pending";
          const done = status === "complete" || status === "reused";
          return (
            <li
              key={id}
              data-state={status}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="generation-step-icon" aria-hidden="true">
                {done ? <Check size={13} strokeWidth={2.5} /> : index + 1}
              </span>
              <span>{label}</span>
              {status === "reused" && (
                <span className="generation-step-saved">Saved</span>
              )}
              {status === "complete" && (
                <span className="sr-only">Complete</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
