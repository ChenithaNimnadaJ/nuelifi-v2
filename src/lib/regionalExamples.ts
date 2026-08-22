import type { RegionId } from "./api";

export type MealExample = { name: string; image: string };

const image = {
  bowl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=500&q=80",
  rice: "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=500&q=80",
  noodles: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=500&q=80",
  salmon: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=500&q=80",
  beans: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=500&q=80",
  flatbread: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=500&q=80",
};

const examplesByRegion: Record<RegionId, MealExample[]> = {
  global: [{ name: "Colourful grain bowl", image: image.bowl }, { name: "Rice, vegetables, and protein", image: image.rice }, { name: "Noodles with egg and greens", image: image.noodles }],
  "south-asia": [{ name: "Rice, dhal, vegetables, and fish", image: image.rice }, { name: "Roti with chickpea curry and greens", image: image.flatbread }, { name: "Chicken rice bowl with vegetables", image: image.bowl }],
  "east-asia": [{ name: "Rice, tofu, and seasonal vegetables", image: image.rice }, { name: "Noodles with egg and greens", image: image.noodles }, { name: "Fish, rice, and steamed vegetables", image: image.salmon }],
  "southeast-asia": [{ name: "Rice noodles with vegetables and tofu", image: image.noodles }, { name: "Rice, greens, and grilled chicken", image: image.rice }, { name: "Vegetable and egg rice bowl", image: image.bowl }],
  europe: [{ name: "Whole-grain bread, vegetables, and fish", image: image.salmon }, { name: "Potatoes, greens, and chicken", image: image.bowl }, { name: "Grain salad with beans and vegetables", image: image.bowl }],
  "north-america": [{ name: "Whole grains, vegetables, and lean protein", image: image.bowl }, { name: "Bean and vegetable grain bowl", image: image.beans }, { name: "Salmon with greens and potatoes", image: image.salmon }],
  "latin-america": [{ name: "Beans, rice, vegetables, and chicken", image: image.beans }, { name: "Black bean and avocado bowl", image: image.bowl }, { name: "Rice, beans, and roasted vegetables", image: image.rice }],
  mena: [{ name: "Flatbread, hummus, vegetables, and chicken", image: image.flatbread }, { name: "Lentils, rice, and fresh salad", image: image.rice }, { name: "Grilled fish with grains and vegetables", image: image.salmon }],
  "sub-saharan-africa": [{ name: "Staple grain, legumes, vegetables, and fish", image: image.rice }, { name: "Beans, greens, and a grain staple", image: image.beans }, { name: "Vegetable stew with grains and chicken", image: image.bowl }],
};

export function getMealExamples(region?: RegionId): MealExample[] { return examplesByRegion[region || "global"] || examplesByRegion.global; }
