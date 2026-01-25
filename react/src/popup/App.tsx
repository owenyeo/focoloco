import { useState } from "react";

export default function App() {
  const [minutes, setMinutes] = useState<number>(25);

  return (
    <div>
      <h2>Focoroco</h2>
      <input
        type="number"
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
      />
    </div>
  );
}
