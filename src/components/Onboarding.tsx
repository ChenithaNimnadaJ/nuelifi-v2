import { useState } from "react";
import type { HealthContext, UserPreferences } from "../lib/api";

export type OnboardingValues = { name: string; goals: string[]; preferences: UserPreferences };

const goalOptions = ["Reduce blood sugar", "Lower cholesterol", "Eat more vegetables", "Build consistent habits", "Improve energy", "Support healthy weight"];
const dietOptions = ["No preference", "Vegetarian", "Vegan", "Pescatarian", "Halal", "Gluten-aware"];
const activityOptions = ["Mostly sitting", "Lightly active", "Active most days", "Very active"];
const listValue = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
const initialContext = (preferences: UserPreferences): HealthContext => preferences.healthContext || { conditions: [], allergies: [], notes: "" };

export function Onboarding({ initialName = "", initialPreferences = {}, onComplete }: { initialName?: string; initialPreferences?: UserPreferences; onComplete: (values: OnboardingValues) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const context = initialContext(initialPreferences);
  const [name, setName] = useState(initialName);
  const [goals, setGoals] = useState<string[]>(Array.isArray(initialPreferences.goals) ? initialPreferences.goals.map(String) : []);
  const [diet, setDiet] = useState(String(initialPreferences.dietaryPreference || dietOptions[0]));
  const [activity, setActivity] = useState(String(initialPreferences.activityLevel || activityOptions[1]));
  const [conditions, setConditions] = useState(context.conditions.join(", "));
  const [allergies, setAllergies] = useState(context.allergies.join(", "));
  const [contextNotes, setContextNotes] = useState(context.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleGoal = (goal: string) => setGoals((current) => current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]);
  const next = () => { if (step === 0 && name.trim().length < 2) { setError("Add your name so Nuelifi can personalise your space."); return; } setError(""); setStep((current) => Math.min(2, current + 1)); };
  const finish = async () => { setBusy(true); setError(""); try { await onComplete({ name: name.trim(), goals, preferences: { ...initialPreferences, onboardingCompleted: true, dietaryPreference: diet, activityLevel: activity, healthContext: { conditions: listValue(conditions), allergies: listValue(allergies), notes: contextNotes.trim().slice(0, 600) } } }); } catch (value) { setError(value instanceof Error ? value.message : "Could not save your preferences. Please try again."); } finally { setBusy(false); } };

  return <div className="onboarding-screen"><div className="onboarding-progress"><span style={{ width: `${((step + 1) / 3) * 100}%` }}/></div><p className="eyebrow">SET UP YOUR PRIVATE SPACE</p><h1>{step === 0 ? "Let’s make Nuelifi yours" : step === 1 ? "What would you like to focus on?" : "A little more context"}</h1><p className="onboarding-subtitle">{step === 0 ? "A few quick details help us keep recommendations practical and relevant." : step === 1 ? "Choose as many as feel useful. You can change these later." : "These preferences help Nuelifi frame meals and daily actions more safely."}</p>{step === 0 && <label className="auth-field onboarding-field"><span>Your name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Sarah Chen" /></label>}{step === 1 && <div className="choice-grid">{goalOptions.map((goal) => <button type="button" key={goal} className={`choice-chip ${goals.includes(goal) ? "selected" : ""}`} onClick={() => toggleGoal(goal)}>{goals.includes(goal) ? "✓ " : ""}{goal}</button>)}</div>}{step === 2 && <div className="onboarding-selects"><label className="auth-field"><span>Known health conditions <em>(optional)</em></span><input value={conditions} onChange={(event) => setConditions(event.target.value)} placeholder="e.g. high blood pressure" /><small className="auth-helper">Only add conditions already identified by a qualified clinician. Separate multiple items with commas.</small></label><label className="auth-field"><span>Food allergies or intolerances <em>(optional)</em></span><input value={allergies} onChange={(event) => setAllergies(event.target.value)} placeholder="e.g. peanuts, lactose" /><small className="auth-helper">Nuelifi will treat these as constraints, not diagnoses.</small></label><label className="auth-field"><span>Dietary preference</span><select value={diet} onChange={(event) => setDiet(event.target.value)}>{dietOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label className="auth-field"><span>Activity level</span><select value={activity} onChange={(event) => setActivity(event.target.value)}>{activityOptions.map((option) => <option key={option}>{option}</option>)}</select></label><label className="auth-field"><span>Anything else Nuelifi should keep in mind? <em>(optional)</em></span><textarea value={contextNotes} onChange={(event) => setContextNotes(event.target.value)} maxLength={600} placeholder="Optional context, such as foods you avoid or how you prefer advice to be framed." rows={3}/></label></div>}{error && <div className="data-note data-error" role="alert">{error}</div>}<div className="onboarding-actions">{step > 0 && <button className="button button-soft" type="button" onClick={() => setStep((current) => current - 1)}>Back</button>}{step < 2 ? <button className="button button-green" type="button" onClick={next}>Continue <span>→</span></button> : <button className="button button-green" type="button" onClick={finish} disabled={busy}>{busy ? "Saving…" : "Finish setup"}</button>}</div><small className="onboarding-footnote">You can update these choices anytime from Profile.</small></div>;
}
