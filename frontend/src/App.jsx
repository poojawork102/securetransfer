import { useState, useEffect } from "react";
import Header from "./components/Header";
import Tabs from "./components/Tabs";
import DemoTab from "./components/demo/DemoTab";
import HowItWorksTab from "./components/howItWorks/HowItWorksTab";
import CalculatorTab from "./components/calculator/CalculatorTab";
import ResultsTab from "./components/results/ResultsTab";
import WiresharkTab from "./components/wireshark/WiresharkTab";
import { useSocket } from "./hooks/useSocket";

const TAB_LIST = [
  { id: "demo", label: "Demo" },
  { id: "howitworks", label: "How it works" },
  { id: "calculator", label: "Calculator" },
  { id: "results", label: "Results" },
  { id: "wireshark", label: "Wireshark" },
];

export default function App() {
  const [tab, setTab] = useState(() => localStorage.getItem("st-tab") || "demo");
  const socket = useSocket();

  useEffect(() => {
    localStorage.setItem("st-tab", tab);
  }, [tab]);

  return (
    <div className="app">
      <Header status={socket.status} />
      <Tabs tabs={TAB_LIST} active={tab} onChange={setTab} />
      <main className="tab-content">
        {tab === "demo" && <DemoTab socket={socket} />}
        {tab === "howitworks" && <HowItWorksTab />}
        {tab === "calculator" && <CalculatorTab />}
        {tab === "results" && <ResultsTab />}
        {tab === "wireshark" && <WiresharkTab />}
      </main>
    </div>
  );
}
