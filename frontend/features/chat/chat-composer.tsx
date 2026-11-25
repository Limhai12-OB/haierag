"use client";

import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatComposer({
  onSend,
  onStop,
  streaming,
  disabled,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || streaming || disabled) return;
    onSend(text);
    setValue("");
    ref.current?.focus();
  }

  return (
    <form
      className="relative mx-auto w-full max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="chat-input" className="sr-only">
        Ask a question
      </label>
      <Textarea
        id="chat-input"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about your documents…  (Enter to send, Shift+Enter for a new line)"
        rows={1}
        maxLength={8000}
        disabled={disabled}
        className="max-h-48 min-h-12 resize-none rounded-xl py-3 pr-12 field-sizing-content"
      />
      <div className="absolute right-2 bottom-2">
        {streaming ? (
          <Button type="button" size="icon-sm" variant="secondary" onClick={onStop} aria-label="Stop generating">
            <Square className="fill-current" aria-hidden />
          </Button>
        ) : (
          <Button type="submit" size="icon-sm" disabled={!value.trim() || disabled} aria-label="Send message">
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>
    </form>
  );
}
