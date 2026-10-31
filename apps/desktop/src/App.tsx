import { useState } from "react";
import { Icon, type IconName } from "./ui/Icon";
import { Bar } from "./ui/kit";
import { Login } from "./screens/Login";
import { NewProject, type Source, type Settings } from "./screens/NewProject";
import { Processing } from "./screens/Processing";
import { Projects } from "./screens/Projects";
import { ProjectClips } from "./screens/ProjectClips";
import { Editor } from "./screens/Editor";
import { Presets } from "./screens/Presets";
import { Account } from "./screens/Account";
import { Diagnostics } from "./screens/Diagnostics";
import { PROJECTS } from "./data";

export type Route = "new" | "processing" | "projects" | "clips" | "editor" | "presets" | "account" | "diag";

const NAV: { id: Route; label: string; icon: IconName }[] = [
  { id: "new", label: "Новый проект", icon: "plus" },
  { id: "projects", label: "Проекты", icon: "folder" },
  { id: "presets", label: "Пресеты", icon: "layers" },
  { id: "account", label: "Аккаунт", icon: "user" },
];

const read = (k: string) => {
  try { return localStorage.getItem(k); } catch { return null; }
};

export function App() {
  const [authed, setAuthed] = useState(read("narezai-demo-auth") === "1");
  const [route, setRoute] = useState<Route>("new");
  const [source, setSource] = useState<Source | null>(null);
  const [settings, setSettings] = useState<Settings>({ length: "30-60", count: "auto", lang: "auto", format: "9:16" });
  const [preset, setPreset] = useState("karaoke");
  const [projectId, setProjectId] = useState("p1");
  const [clipId, setClipId] = useState("c1");

  if (!authed) {
    return <Login onDone={() => { try { localStorage.setItem("narezai-demo-auth", "1"); } catch { /* ignore */ } setAuthed(true); }} />;
  }

  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0];
  const go = (r: Route) => setRoute(r);

  if (route === "editor") {
    return <Editor clipId={clipId} preset={preset} onPreset={setPreset} onBack={() => go("clips")} />;
  }

  const active: Route = route === "processing" ? "new" : route === "clips" ? "projects" : route === "diag" ? "account" : route;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark"><Icon name="scissors" size={16} /></span>
          Нарезай
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} aria-current={active === n.id ? "page" : undefined} onClick={() => go(n.id)}>
              <Icon name={n.icon} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="quota">
            <div className="row">
              <span className="eyebrow">Минуты ИИ</span>
              <span className="spacer" />
              <span className="badge badge--accent">Пробный</span>
            </div>
            <div className="quota__nums"><b>42</b><span className="muted">из 60 осталось</span></div>
            <Bar value={(42 / 60) * 100} />
          </div>
        </div>
      </aside>
      <main className="main">
        {route === "new" && (
          <NewProject
            source={source} onSource={setSource} settings={settings} onSettings={setSettings}
            preset={preset} onPreset={setPreset}
            onStart={() => go("processing")}
          />
        )}
        {route === "processing" && <Processing source={source} onDone={() => { setProjectId("p1"); go("clips"); }} onCancel={() => go("new")} />}
        {route === "projects" && <Projects onOpen={(id) => { setProjectId(id); go("clips"); }} onNew={() => go("new")} />}
        {route === "clips" && (
          <ProjectClips project={project} clipId={clipId} onClip={setClipId} preset={preset} onBack={() => go("projects")} onEdit={() => go("editor")} />
        )}
        {route === "presets" && <Presets preset={preset} onPreset={setPreset} />}
        {route === "account" && <Account onDiag={() => go("diag")} onSignOut={() => { try { localStorage.removeItem("narezai-demo-auth"); } catch { /* ignore */ } setAuthed(false); }} />}
        {route === "diag" && <Diagnostics onBack={() => go("account")} />}
      </main>
    </div>
  );
}
