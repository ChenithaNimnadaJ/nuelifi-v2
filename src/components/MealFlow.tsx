import { useState } from "react";
import type { Meal, RegionId } from "../lib/api";
import { getMealExamples } from "../lib/regionalExamples";
import { FreeAds } from "./FreeAds";

export interface MealDraft { imageUrls: string[]; imageUrl: string; mealName: string; }
export interface ResultAction { id: string; title: string; detail: string; completed: boolean; added: boolean; }

const icon = (name: string, size = 18) => { const paths: Record<string, string> = { camera: "M4 7.5h3l1.2-2h7.6l1.2 2h3A1.8 1.8 0 0 1 22 9.3v9.2a1.8 1.8 0 0 1-1.8 1.8H3.8A1.8 1.8 0 0 1 2 18.5V9.3a1.8 1.8 0 0 1 1.8-1.8zM12 17a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 12 17z", upload: "M12 16V4m0 0L7 9m5-5 5 5M4 20h16", check: "M20 6 9 17l-4-5", arrow: "m9 18 6-6-6-6", leaf: "M20 4C11 4 5 8 5 14c0 3 2 5 5 5 6 0 10-6 10-15zM4 21c2-5 6-8 11-11" }; return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.leaf}/></svg>; };
function Badge({ children }: { children: React.ReactNode }) { return <span className="badge badge-green">{children}</span>; }
function metric(indicators: Record<string, number>, key: string, unit: string) { const value = indicators[key]; if (!Number.isFinite(value)) return "—"; const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1)); return `~${rounded} ${unit}`; }

function imageFileToDataUrl(file: File): Promise<string> {
  const fallback = () => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("This image could not be read."));
    reader.readAsDataURL(file);
  });
  if (typeof createImageBitmap !== "function") return fallback();
  return createImageBitmap(file).then((bitmap) => {
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); throw new Error("This image could not be prepared."); }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
  }).catch(() => fallback());
}

export function MealCapture({ onReady, region = "global" }: { onReady: (draft: MealDraft) => void; region?: RegionId }) {
  const examples = getMealExamples(region);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [preparing, setPreparing] = useState(false);
  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setPreparing(true); try { const image = await imageFileToDataUrl(file); setSelected([image]); setName(file.name.replace(/\.[^/.]+$/, "")); } finally { setPreparing(false); event.target.value = ""; } };
  const chooseExample = (example: typeof examples[number]) => { setSelected([example.image]); setName(example.name); };
  const selectedImage = selected[0] || "";
  return <div className="screen"><p className="screen-intro">Take one clear photo or upload one image of your meal. Neulifi will use that single view for an honest assessment and practical next steps — no guilt, just useful information.</p><div className="upload-zone">{selectedImage ? <img className="capture-image-single" src={selectedImage} alt="Selected meal photo"/> : <><span className="upload-icon">{icon("camera", 28)}</span><strong>{preparing ? "Preparing your meal photo…" : "Your meal photo will appear here"}</strong><small>{preparing ? "Optimising the image for a reliable scan" : "Use one clear photo with the meal visible"}</small></>}</div><div className="upload-actions"><label className="button button-dark">{icon("camera", 17)} Take photo<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => { void chooseFile(event); }}/></label><label className="button button-soft">{icon("upload", 17)} Upload<input className="sr-only" type="file" accept="image/*" onChange={(event) => { void chooseFile(event); }}/></label></div><p className="or-label">OR TRY AN EXAMPLE</p><div className="example-row">{examples.map((example) => <button type="button" key={example.name} aria-pressed={selectedImage === example.image} onClick={() => chooseExample(example)} aria-label={`Use example: ${example.name}`}><img src={example.image} alt={example.name}/></button>)}</div>{selectedImage && <><small className="capture-count">One photo ready</small><button type="button" className="button button-green analyse-submit" onClick={() => onReady({ imageUrls: [selectedImage], imageUrl: selectedImage, mealName: name || "New meal" })} disabled={preparing}>{preparing ? "Preparing…" : "Analyse meal"} <span>{icon("arrow", 17)}</span></button></>}</div>;
}
export function MealPreview({ draft, onRetake, onAnalyse, error = "" }: { draft: MealDraft; onRetake: () => void; onAnalyse: () => void; error?: string }) {
  const image = draft.imageUrl || draft.imageUrls?.[0] || "";
  return <div className="screen flow-screen">{error && <div className="data-note data-error" role="alert">{error}</div>}<p className="screen-intro">Make sure the meal is clearly visible in your photo before continuing.</p><div className="preview-image-wrap"><img src={image} alt="Meal preview"/><span className="preview-chip">Photo preview</span></div><h2 className="flow-meal-name">{draft.mealName}</h2><p className="muted flow-help">Neulifi will use this one photo to prepare a simple assessment and practical next steps.</p><div className="flow-actions"><button type="button" className="button button-soft" onClick={onRetake}>Retake</button><button type="button" className="button button-dark" onClick={onAnalyse}>Analyse meal {icon("arrow", 16)}</button></div></div>;
}
export function Analysing() { return <div className="screen analysing-screen" role="status" aria-live="polite"><div className="analysis-orbit"><span/><span/><span/></div><h1>Analysing your meal</h1><p>Neulifi is looking at your meal and preparing clear observations and one practical next step.</p><div className="analysis-progress"><span/></div><small>This usually takes a few seconds</small></div>; }

export function MealResults({ meal, actions, onAction, onAddTask, onDone, showFreeAds }: { meal: Meal; actions: ResultAction[]; onAction: (id: string) => void; onAddTask: (id: string) => void; onDone: () => void; showFreeAds: boolean }) {
  const indicators = meal.analysis.indicators || {};
  const portionBalance = Number.isFinite(indicators.portionBalance) ? indicators.portionBalance : null;
  const portionBalanceLabel = portionBalance === null ? "—" : `~${portionBalance > 3 ? Math.round(portionBalance) : Number(portionBalance.toFixed(1))}/${portionBalance > 3 ? 100 : 3}`;
  const values = [
    { label: "Calories", value: metric(indicators, "calories", "kcal") },
    { label: "Protein", value: metric(indicators, "protein", "g") },
    { label: "Carbohydrates", value: metric(indicators, "carbohydrates", "g") },
    { label: "Fat", value: metric(indicators, "fats", "g") },
    { label: "Fibre", value: metric(indicators, "fibre", "g") },
    { label: "Sugar", value: metric(indicators, "sugar", "g") },
    { label: "Sodium", value: metric(indicators, "sodium", "mg") },
    { label: "Vegetables", value: metric(indicators, "vegetables", "servings") },
    { label: "Portion balance", value: portionBalanceLabel },
  ];
  const good = [
    Number(indicators.protein) >= 20 ? "Good protein source" : "Includes a protein source",
    Number(indicators.vegetables) >= 2 ? "Contains vegetables" : "Includes some plant food",
    Number(indicators.fibre) >= 5 ? "Provides useful fibre" : "A clear meal foundation",
  ];
  const improve = [
    Number(indicators.vegetables) < 3 ? "Add another serving of vegetables for more fibre and micronutrients." : "Keep the vegetable variety going across the day.",
    Number(indicators.fibre) < 8 ? "Fibre could be higher with beans, whole grains, fruit, or another vegetable." : "Your fibre estimate is a strength to maintain.",
    Number(indicators.sodium) > 800 ? "Consider a lower-sodium option or smaller amount of sauces next time." : "Use the recommendations below for the most relevant next step.",
  ];
  return <div className="screen results-screen"><div className="result-hero"><img src={meal.imageUrl} alt={meal.mealName}/><div className="result-hero-copy"><p className="eyebrow light">MEAL BALANCE</p><Badge>{meal.analysis.rating}</Badge><div className="result-score">{meal.analysis.score}<small>/100</small></div></div></div><h1 className="result-title">Here is what Neulifi noticed</h1><p className="result-summary">{meal.analysis.explanation}</p><section className="result-section"><h3>Approximate signals from your photo</h3><div className="nutrition-grid">{values.map((item) => <div className="nutrition-item" key={item.label}><small>{item.label}</small><strong>{item.value}</strong></div>)}</div></section><section className="result-section"><h3>What is looking good</h3><div className="positive-list">{good.map((item) => <p key={item}><span>{icon("check", 14)}</span>{item}</p>)}</div></section><section className="result-section"><h3>One or two ways to improve</h3><div className="improve-list">{improve.slice(0, 2).map((item) => <p key={item}>• {item}</p>)}</div></section><section className="result-section recommendations"><h3>How could you improve this meal?</h3>{meal.analysis.mealGuidance.length ? meal.analysis.mealGuidance.map((item, index) => <div className="recommendation" key={`${item}-${index}`}><span>{index + 1}</span><div><strong>{item}</strong><small>Meal-specific guidance — not added to tasks.</small></div></div>) : <p className="empty-task-note">No meal-specific change is needed for this meal.</p>}</section><section className="result-section result-actions"><div className="result-actions-heading"><h3>Simple steps for today</h3></div>{actions.length ? actions.map((action) => <div className="result-action-row" key={action.id}><button type="button" className={`result-action ${action.completed ? "completed" : ""} ${!action.added ? "pending-task" : ""}`} disabled={!action.added} onClick={() => onAction(action.id)}><span className="result-checkbox">{action.completed ? "✓" : ""}</span><span className="result-action-copy"><strong>{action.title}</strong><small>{action.detail}</small></span></button>{action.added ? <span className="result-action-added">Added</span> : <button type="button" className="add-task-button" onClick={() => onAddTask(action.id)}>+ Add to Tasks</button>}</div>) : <p className="empty-task-note">No daily action is needed from this meal.</p>}</section><div className="bottom-guidance"><strong>You don't need to change everything.</strong><span>Start with one improvement.</span></div>{showFreeAds && <FreeAds slot="analysis"/>}<button type="button" className="button button-green done-button" onClick={onDone}>Done — back to dashboard</button></div>;
}
