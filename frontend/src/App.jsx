import { useState, useEffect } from "react";
import Header from "./components/Header";
import Tabs from "./components/Tabs";
import DemoTab from "./components/demo/DemoTab";
import HowItWorksTab from "./components/howItWorks/HowItWorksTab";
import CalculatorTab from "./components/calculator/CalculatorTab";
import ResultsTab from "./components/results/ResultsTab";
import LiveTerminal from "./components/terminal/LiveTerminal";
import { useSocket } from "./hooks/useSocket";

const TAB_LIST = [
  { id: "demo", label: "Demo" },
  { id: "howitworks", label: "How it works" },
  { id: "calculator", label: "Calculator" },
  { id: "results", label: "Results" },
];

export default function App() {
  const [tab, setTab] = useState(() => localStorage.getItem("st-tab") || "demo");
  const [demoState, setDemoState] = useState({ running: false, activeObj: null });
  const [calcPrefill, setCalcPrefill] = useState(null);
  const socket = useSocket();

  useEffect(() => {
    localStorage.setItem("st-tab", tab);
  }, [tab]);

  function openCalculator(prefill) {
    setCalcPrefill(prefill);
    setTab("calculator");
  }

  return (
    <div className="app">
      <Header status={socket.status} />
      <Tabs tabs={TAB_LIST} active={tab} onChange={setTab} />
      <main className="tab-content">
        {tab === "demo" && <DemoTab socket={socket} onStateChange={setDemoState} onOpenCalculator={openCalculator} />}
        {tab === "howitworks" && <HowItWorksTab />}
        {tab === "calculator" && <CalculatorTab prefill={calcPrefill} onPrefillUsed={() => setCalcPrefill(null)} />}
        {tab === "results" && <ResultsTab />}
      </main>
      <LiveTerminal
        socket={socket}
        activeObj={demoState.activeObj}
        running={demoState.running}
      />
    </div>
  );
}
