import "@fontsource-variable/onest";
import "./styles.css";
import "../../../app/dashboard/dashboard-geometry.css";
import "../../../app/product/product.css";
import "./desktop-fixes.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Same root classes as app/layout.tsx: dark product default, Onest.
document.documentElement.classList.add("dark", "font-sans");
createRoot(document.getElementById("root")!).render(<App />);
