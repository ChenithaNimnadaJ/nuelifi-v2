import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const emptyDb = () => ({
  users: [],
  meals: [],
  actions: [],
  subscriptions: [],
});

export async function createStore(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  let data;
  try {
    data = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    data = emptyDb();
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }
  const db = { ...emptyDb(), ...data };

  async function persist() {
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(db, null, 2));
    await rename(tempPath, filePath);
  }

  return {
    db,
    persist,
    findUser: (id) => db.users.find((user) => user.id === id),
    findMeal: (id) => db.meals.find((meal) => meal.id === id),
    findAction: (id) => db.actions.find((action) => action.id === id),
  };
}
