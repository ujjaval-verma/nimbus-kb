import type { Turn } from "../session";
import { AnswerCard } from "./AnswerCard";

export function Message({ turn, nameOf }: { turn: Turn; nameOf: (id: string) => string }) {
  return (
    <div className="message">
      <div className="bubble">{turn.question}</div>
      <AnswerCard turn={turn} nameOf={nameOf} />
    </div>
  );
}
