import { useEffect, useState } from "react";
import { ipc } from "./lib/ipc";
import "./App.css";

function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    ipc.getAppVersion().then(setVersion);
  }, []);

  return (
    <main className="shell">
      <h1>Null</h1>
      {version && <p className="version">v{version}</p>}
    </main>
  );
}

export default App;
