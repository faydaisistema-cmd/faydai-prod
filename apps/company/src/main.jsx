import React from "react";
import ReactDOM from "react-dom/client";
import PsychosocialDashboard from "./PsychosocialDashboard.jsx";
import "./index.css";

// PsychosocialDashboard é a página principal do painel da empresa
// (decisão registrada em deploy-checklist.md, Fase 4.5). CompanyDashboard.jsx
// permanece no repositório mas não é importado aqui — se for retomado no
// futuro, precisa ser plugado explicitamente (ex: como rota alternativa).
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PsychosocialDashboard />
  </React.StrictMode>
);

