import { useEffect, useRef, useState } from "react";
import { chatReactions } from "./chatReactions.js";

export default function FloatingReactions({ channel }) {
  const [reactions, setReactions] = useState([]);
  const nextId = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const subscription = channel.on("reaction.new", ({ reaction }) => {
      if (document.hidden || reducedMotion.matches) return;
      const option = chatReactions.find(({ type }) => type === reaction?.type);
      if (!option) return;

      const id = nextId.current++;
      setReactions((current) => [...current.slice(-3), { id, emoji: option.emoji }]);
    });
    return () => subscription.unsubscribe();
  }, [channel]);

  return (
    <div className="sayup-floating-reactions" aria-hidden="true">
      {reactions.map(({ id, emoji }) => (
        <div
          className="sayup-floating-reaction"
          key={id}
          style={{ left: `${[64, 39, 81, 51][id % 4]}%` }}
          onAnimationEnd={() => setReactions((current) => current.filter((item) => item.id !== id))}
        >
          <span>{emoji}</span>
        </div>
      ))}
    </div>
  );
}
