import { useLayoutEffect, useRef, useState } from "react";
import { MAX_QUESTION_CHARS } from "../limits";

export function Composer({ streaming, onSend }: { streaming: boolean; onSend: (q: string) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const blank = value.trim() === "";

  // Grow with the content; CSS max-height stops it at about 6 lines and the box scrolls after that.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const submit = () => {
    if (blank || streaming) return;
    onSend(value);
    setValue("");
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor="question" className="sr-only">Your question</label>
      <textarea id="question" ref={ref} rows={1} value={value} maxLength={MAX_QUESTION_CHARS}
        placeholder="Ask about Relay, Vault, Pulse or Ledger…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
        }} />
      <button type="submit" className="primary" disabled={blank || streaming}>Send</button>
    </form>
  );
}
