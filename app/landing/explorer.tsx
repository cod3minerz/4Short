"use client";

import { Tabs } from "@base-ui/react/tabs";
import { track } from "../lib/analytics";
import { CaptionWords } from "./cut-scene";
import { exampleMoments, formatClock } from "./data";

export function MomentsExplorer() {
  return (
    <Tabs.Root className="lp-explorer" defaultValue={exampleMoments[0]!.id} orientation="vertical" onValueChange={(value) => track("landing_moment_select", { moment: value })}>
      <Tabs.List className="lp-moment-list" aria-label="Найденные моменты (пример)">
        {exampleMoments.map((moment, index) => (
          <Tabs.Tab key={moment.id} value={moment.id} className="lp-moment">
            <span className="lp-moment__top">
              <span>{index + 1}. {formatClock(moment.startSeconds)}–{formatClock(moment.endSeconds)}</span>
              <em>{moment.topic}</em>
            </span>
            <strong>{moment.title}</strong>
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <div>
        {exampleMoments.map((moment) => (
          <Tabs.Panel key={moment.id} value={moment.id} className="lp-panel">
            <div className="lp-panel__head">
              <span className="lp-header-1" style={{ fontSize: 15, lineHeight: "20px" }}>Расшифровка</span>
              <span className="lp-sample">пример · границы можно сдвинуть в редакторе</span>
            </div>
            <ol className="lp-lines">
              {moment.lines.map((line) => (
                <li key={line.at} className={`lp-line${line.in ? " is-in" : ""}`}>
                  <time className="lp-mono">{line.at}</time>
                  <span>{line.text}</span>
                </li>
              ))}
            </ol>
            <div className="lp-why">
              <div>
                <h3>{moment.title}</h3>
                <dl>
                  <dt>Тема</dt>
                  <dd>{moment.topic}</dd>
                  <dt>Длина</dt>
                  <dd>{formatClock(moment.endSeconds - moment.startSeconds)}</dd>
                  <dt>Почему выбран</dt>
                  <dd>{moment.why}</dd>
                </dl>
              </div>
              <div className="lp-frame lp-frame--static" aria-hidden="true">
                <CaptionWords words={moment.caption} />
              </div>
            </div>
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  );
}
