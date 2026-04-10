import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UndoProvider } from "./contexts/UndoContext";
import "./styles/global.css";
import "./styles/reactflow.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <UndoProvider>
        <App />
      </UndoProvider>
    </BrowserRouter>
  </React.StrictMode>
);
