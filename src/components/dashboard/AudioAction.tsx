import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function AudioAction({ label, load, unavailable }: {
  label: string;
  load: () => Promise<Response>;
  unavailable: string;
}) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function play() {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setLoading(true);
    setError("");
    setUrl(undefined);
    try {
      const response = await load();
      if (!response.ok) throw new Error();
      const audio = await response.blob();
      if (!audio.size || !audio.type.startsWith("audio/")) throw new Error();
      if (!request.signal.aborted) setUrl(URL.createObjectURL(audio));
    } catch {
      if (!request.signal.aborted) setError(unavailable);
    } finally {
      pending.current = null;
      if (!request.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void play()}>
        {loading ? "Loading…" : label}
      </Button>
      {url && <audio className="max-w-full" controls autoPlay src={url} onError={() => setError(unavailable)} />}
      {error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}
    </div>
  );
}
