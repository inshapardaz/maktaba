import { useEffect, useState } from "react";

type HelloResponse = { message: string };

function App() {
  const [status, setStatus] = useState<
    { state: "loading" } | { state: "ok"; message: string } | { state: "error"; error: string }
  >({ state: "loading" });

  useEffect(() => {
    const { apiBaseUrl, token } = window.maktaba;

    fetch(`${apiBaseUrl}/api/hello`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Backend responded with ${res.status}`);
        }
        return res.json() as Promise<HelloResponse>;
      })
      .then((data) => setStatus({ state: "ok", message: data.message }))
      .catch((err: unknown) =>
        setStatus({ state: "error", error: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
      <h1>مکتبہ — Maktaba</h1>
      {status.state === "loading" && <p>Contacting backend…</p>}
      {status.state === "ok" && <p>Backend says: {status.message}</p>}
      {status.state === "error" && <p style={{ color: "crimson" }}>Backend error: {status.error}</p>}
    </main>
  );
}

export default App;
