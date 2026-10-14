import { useRef, useState } from 'react';

export interface ActionMessage {
  text: string;
  error: boolean;
}

/** Runs one async action at a time and keeps its outcome message for display. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const running = useRef(false);

  async function run(action: () => Promise<ActionMessage | null>): Promise<void> {
    if (running.current) {
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      setMessage(await action());
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, message, run, clear: () => setMessage(null) };
}
