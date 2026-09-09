"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useState } from "react";
import { StudentStimulus } from "@/components/StudentStimulus";

export default function EyeReviewPage() {
  const [payload, setPayload] = useState<any>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [overlayScale, setOverlayScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = (event: PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); (event.currentTarget as any)._drag = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; };
  const dragMove = (event: PointerEvent<HTMLDivElement>) => { if (!dragging) return; const start = (event.currentTarget as any)._drag; if (start) setOffset({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y }); };
  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => { const step = event.shiftKey ? 10 : 1; if (event.key === "ArrowLeft") setOffset((v) => ({ ...v, x: v.x - step })); if (event.key === "ArrowRight") setOffset((v) => ({ ...v, x: v.x + step })); if (event.key === "ArrowUp") setOffset((v) => ({ ...v, y: v.y - step })); if (event.key === "ArrowDown") setOffset((v) => ({ ...v, y: v.y + step })); if (event.key.startsWith("Arrow")) event.preventDefault(); };
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("key");
    if (key) { const value = window.localStorage.getItem(key); if (value) setPayload(JSON.parse(value)); window.localStorage.removeItem(key); }
  }, []);
  useEffect(() => {
    if (!payload) return;
    const captured = payload.question?.gaze_layout?.viewport;
    const capturedStimulus = payload.question?.gaze_layout?.components?.find((item: any) => item.component === "stimulus")?.rect;
    const screen = document.querySelector<HTMLElement>(".eye-review-screen");
    const replayStimulus = screen?.querySelector<HTMLElement>("[data-gaze-component='stimulus']")?.getBoundingClientRect();
    if (captured?.width && captured?.height && capturedStimulus && replayStimulus && screen) {
      const screenRect = screen.getBoundingClientRect();
      setOffset({ x: replayStimulus.left - screenRect.left - (capturedStimulus.left / captured.width) * screenRect.width, y: replayStimulus.top - screenRect.top - (capturedStimulus.top / captured.height) * screenRect.height });
    }
  }, [payload]);
  if (!payload) return <main className="eye-review-standalone"><p>Memuat preview...</p></main>;
  const question = payload.question;
  const data = payload.source === "webgazer" ? question.eye_tracking_webgazer : question.eye_tracking;
  const points = data?.trajectory ?? [];
  const options = question.gaze_layout?.question?.options ?? [];
  return <main className="eye-review-standalone"><header><strong>{payload.view === "heatmap" ? "Eye heatmap" : "Trajektori eye gaze"} — {payload.source}</strong><span>{question.question_id}</span></header><div className="eye-review-controls">Geser overlay: drag atau tombol panah <button type="button" onClick={() => setOffset({ x: 0, y: 0 })}>Reset posisi</button><button type="button" onClick={() => setOverlayScale((value) => Math.max(.5, value - .05))}>−</button><span>{Math.round(overlayScale * 100)}%</span><button type="button" onClick={() => setOverlayScale((value) => Math.min(2, value + .05))}>+</button><button type="button" onClick={() => setOverlayScale(1)}>Reset ukuran</button></div><section className="eye-review-stage"><div className="eye-review-screen" tabIndex={0} onKeyDown={moveByKeyboard} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}><StudentStimulus questionId={question.question_id} questionText={question.prompt || `Soal ${question.sequence}`} instructionText={question.gaze_layout?.question?.instruction} />{options.length > 0 ? <section className="response-panel multiple-choice-panel replay-answer-panel"><p className="eyebrow">Pilihan jawaban</p><div className="multiple-choice-grid">{options.map((option: string) => <div className="multiple-choice-option" data-gaze-component="answer-option" key={option}>{mediaOption(option)}</div>)}</div></section> : null}<svg className="eye-review-svg" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${overlayScale})` }} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet"><defs><marker id="review-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" /></marker></defs>{payload.view === "trajectory" ? points.slice(1).map((point: any, index: number) => { const previous = points[index]; return <line key={index} x1={(previous.viewport_x ?? previous.x) * 1000} y1={(previous.viewport_y ?? previous.y) * 1000} x2={(point.viewport_x ?? point.x) * 1000} y2={(point.viewport_y ?? point.y) * 1000} markerEnd="url(#review-arrow)" />; }) : data?.heatmap?.map((point: any, index: number) => <g key={index}><circle cx={(point.viewport_x ?? point.x) * 1000} cy={(point.viewport_y ?? point.y) * 1000} r={22 + (point.intensity ?? .5) * 28} /><text className="eye-review-heatmap-label" x={(point.viewport_x ?? point.x) * 1000} y={(point.viewport_y ?? point.y) * 1000 + 4} textAnchor="middle">{(point.duration_seconds ?? .5).toFixed(1)}s</text></g>)}{payload.view === "trajectory" ? (data?.fixations ?? []).map((fixation: any) => <g key={fixation.index}><circle className="eye-review-fixation" cx={(fixation.viewport_x ?? fixation.x) * 1000} cy={(fixation.viewport_y ?? fixation.y) * 1000} r="12" /><text className="eye-review-fixation-label" x={(fixation.viewport_x ?? fixation.x) * 1000} y={(fixation.viewport_y ?? fixation.y) * 1000 + 4} textAnchor="middle">{fixation.index}</text></g>) : null}</svg></div></section></main>;
}

function mediaOption(value: string) { return /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(value.trim()) ? <img className="multiple-choice-media" src={value.trim()} alt="Pilihan jawaban" /> : value; }
