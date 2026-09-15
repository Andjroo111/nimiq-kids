// Demo seed. Idempotent-ish: only seeds when there's no family yet. Run: bun run seed
// Family mode (Andjroo's instance): SEED_FAMILY=1 bun run seed  — seeds routines, lock
// windows, PIN (SEED_PIN, default 0000) and star rewards instead of the demo chores.
import { initDb } from "../db";
import { makeProvider } from "../wallet";
import * as repo from "../repo";
import * as routines from "../repo-routines";
import * as lockRepo from "../repo-lock";
import { hashPin } from "../auth";

const NIM = 100_000; // luna per NIM

async function seedFamilyMode(fam: repo.Family) {
  repo.updateFamilySettings(fam.id, { mode: "family" });
  repo.setFamilyPin(fam.id, await hashPin(process.env.SEED_PIN ?? "0000"));

  // V2: family mode pays NIM directly (kids are real account holders) — 0.1 NIM per task.
  const kids = [repo.createChild(fam.id, "Kid 1", "🦖"), repo.createChild(fam.id, "Kid 2", "🦄")];
  for (const kid of kids) {
    const morning = routines.createRoutine(fam.id, kid.id, "Morning routine", "morning", "🌅");
    routines.addTask(morning.id, "Make your bed", 3 * 60, { emoji: "🛏️", rewardLuna: NIM / 10 });
    routines.addTask(morning.id, "Get dressed", 5 * 60, { emoji: "👕", rewardLuna: NIM / 10 });
    routines.addTask(morning.id, "Brush your teeth", 2 * 60, { emoji: "🪥", rewardLuna: NIM / 10 });
    lockRepo.addLockWindow(morning.id, "06:30", "08:30", "1111100");

    const evening = routines.createRoutine(fam.id, kid.id, "Bedtime routine", "evening", "🌙");
    routines.addTask(evening.id, "Tidy your room", 5 * 60, { emoji: "🧸", rewardLuna: NIM / 10 });
    routines.addTask(evening.id, "Pajamas on", 3 * 60, { emoji: "🩳", rewardLuna: NIM / 10 });
    routines.addTask(evening.id, "Brush your teeth", 2 * 60, { emoji: "🪥", rewardLuna: NIM / 10 });
    lockRepo.addLockWindow(evening.id, "19:00", "20:30", "1111111");

    repo.createChore(fam.id, kid.id, "Put your laundry away", NIM / 2, "🧺");
  }
  console.log(`Seeded FAMILY mode: ${fam.id}, 2 kids, morning+evening routines (NIM rewards), PIN ${process.env.SEED_PIN ?? "0000"}.`);
}

async function main() {
  initDb();
  if (repo.firstFamily()) {
    console.log("Already seeded — skipping.");
    return;
  }
  let address = "NQ00 0000 0000 0000 0000 0000 0000 0000 0000";
  try {
    address = await makeProvider().getAddress();
  } catch { /* sim/no-key: keep placeholder */ }

  const fam = repo.createFamily("Mom", address);
  if (process.env.SEED_FAMILY === "1") {
    await seedFamilyMode(repo.getFamily(fam.id)!);
    return;
  }
  const sam = repo.createChild(fam.id, "Sam", "🦖");
  const ava = repo.createChild(fam.id, "Ava", "🦄");

  // Exactly ONE pending chore for a clean 90s cold-open (matches docs/SPEC.md §2).
  const c1 = repo.createChore(fam.id, sam.id, "Empty the dishwasher", 5 * NIM, "🧽");
  repo.setChoreStatus(c1.id, "submitted");
  repo.createChore(fam.id, sam.id, "Make your bed", 2 * NIM, "🛏️");
  repo.createChore(fam.id, sam.id, "Feed the dog", Math.round(0.25 * NIM), "🐕"); // sub-cent micro-reward
  repo.createChore(fam.id, ava.id, "Water the plants", 2 * NIM, "🌱");
  repo.createChore(fam.id, ava.id, "Set the table", 1 * NIM, "🍽️");
  // Learn-to-Earn: a lesson chore (parent-attested, identical Cashlink payout)
  repo.createChore(fam.id, sam.id, "Finish a Brilliant algebra lesson", 2 * NIM, "📐", { kind: "lesson", subject: "math" });
  repo.createChore(fam.id, ava.id, "Do a Brilliant coding lesson", 2 * NIM, "💻", { kind: "lesson", subject: "coding", rewardShape: "per-streak-day" });

  console.log(`Seeded family ${fam.id} with 2 kids + 5 chores + 2 lessons (1 pending approval).`);
}

main();
