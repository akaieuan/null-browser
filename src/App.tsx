import { useEffect, useState } from "react";
import { ipc } from "./lib/ipc";

function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    ipc.getAppVersion().then(setVersion);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="text-center">
        <h1 className="text-7xl font-light tracking-[-0.04em]">Null</h1>
        {version && (
          <p className="mt-2 text-sm tabular-nums text-neutral-500 dark:text-neutral-500">
            v{version}
          </p>
        )}
      </div>
    </main>
  );
}

export default App;
