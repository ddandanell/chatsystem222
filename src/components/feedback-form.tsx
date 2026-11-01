"use client";
/**
 * Reason and why form for a review. Do not auto-send.
 */

import { useState } from "react";
import { useActionState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SourceRef } from "@/db/schema";
import {
  HUMAN_DECISIONS,
  REASON_CODES,
  type HumanDecision,
} from "@/lib/reason-codes";
import type { ActionState } from "@/app/[workspace]/inbox/[id]/actions";

export function FeedbackForm({
  action,
  draft,
  sources,
  catalog,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  draft: string;
  sources: SourceRef[];
  catalog: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [decision, setDecision] = useState<HumanDecision>("accepted");
  const [finalText, setFinalText] = useState(draft);
  const [reason, setReason] = useState("good_as_drafted");
  const cited = new Set(sources.map((source) => source.id));
  const missingOptions = catalog.filter((doc) => !cited.has(doc.id));
  const needsLearningReason =
    decision === "edited" || decision === "rejected" || decision === "escalated";

  return (
    <form
      id="review-form"
      action={formAction}
      className="flex flex-col gap-5"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
    >
      <input type="hidden" name="human_decision" value={decision} />
      {state?.error ? (
        <Alert variant="destructive">
          <AlertTitle>Review not saved</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel>Decision</FieldLabel>
          <ToggleGroup
            value={[decision]}
            onValueChange={(groupValue) => {
              const next = groupValue[groupValue.length - 1];
              if (
                next === "accepted" ||
                next === "edited" ||
                next === "rejected" ||
                next === "escalated"
              ) {
                setDecision(next);
                if (next === "accepted") {
                  setFinalText(draft);
                  setReason("good_as_drafted");
                } else if (reason === "good_as_drafted") {
                  setReason("missing_knowledge");
                }
              }
            }}
            className="flex flex-wrap"
          >
            {HUMAN_DECISIONS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="final_text">Final text</FieldLabel>
          <Textarea
            id="final_text"
            name="final_text"
            value={finalText}
            onChange={(event) => setFinalText(event.target.value)}
            rows={7}
            required={decision === "accepted" || decision === "edited"}
          />
          <FieldDescription>
            Accepted keeps the draft. Edited records a correction for the Learning
            Queue. Rejected and escalated send nothing.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="reason_code">Reason code</FieldLabel>
          <select
            id="reason_code"
            name="reason_code"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
          >
            {REASON_CODES.filter(
              (item) => !needsLearningReason || item.code !== "good_as_drafted",
            ).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
          {needsLearningReason ? (
            <FieldDescription>
              Required for learning. Your why and the AI vs human diff land on the
              Learning Queue for Approve Snippet or Dismiss.
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="rationale">Why this reply</FieldLabel>
          <Textarea
            id="rationale"
            name="rationale"
            rows={3}
            required
            placeholder={
              needsLearningReason
                ? "What should the next similar draft do instead?"
                : undefined
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="why_not">Why not the alternative</FieldLabel>
          <Textarea id="why_not" name="why_not" rows={3} required />
        </Field>
        <Field>
          <FieldLabel>Sources</FieldLabel>
          <FieldDescription>
            Cited sources stay attached unless you mark them irrelevant. Mark a
            missing file if the draft should have used it.
          </FieldDescription>
          <div className="flex flex-col gap-2">
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sources were cited.</p>
            ) : (
              sources.map((source) => (
                <label key={source.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="irrelevant" value={source.id} />
                  <span>
                    {source.title}{" "}
                    <span className="text-muted-foreground">Irrelevant</span>
                  </span>
                </label>
              ))
            )}
            {missingOptions.map((doc) => (
              <label key={doc.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="missing" value={doc.id} />
                <span>
                  {doc.title}{" "}
                  <span className="text-muted-foreground">Missing</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save review
        </Button>
        <p className="text-sm text-muted-foreground">⌘ Enter or Ctrl Enter</p>
      </div>
    </form>
  );
}
