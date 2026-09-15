// nimiq.kids parent app — the approval queue's SUBJECT names, split out of
// parent.ts because that file crossed this repo's 800-line CI guard (the same
// reason parent-box.ts exists).
//
// These name what is being approved. Unlike a chore title they are composed
// server-side (src/routes/approvals.ts) rather than read off a row, so there was
// no `title_key` to hang them on and they stayed English on every phone — the
// same bug as the seeded titles, in the one place a parent looks most.
//
// Same rules: English is authoritative, the other four mirror its keys exactly.

export const approvEn = {
  "papp.subjRoutine": "Routine",
  "papp.subjChore": "Chore",
  "papp.subjPractice": "Practice",
  "papp.subjPrize": "Prize",
  "papp.subjUnknown": "Task",
  "papp.subjStake": "Grow NIM",
  "papp.subjUnstake": "Take back NIM",
  "papp.subjGiveTo": "Give NIM to {name}",
  "papp.subjCashlink": "Send a Cashlink",
  "papp.shareOf": "of {amount}",
  "papp.shareNoteLabel": "Why not all of it?",
  "papp.shareNotePh": "Bed's still messy",
  "papp.shareApprove": "Pay {amount}",
  "papp.shareAll": "All",
  "papp.pendingStale": "{name} has been waiting {days} days",
};

export const approvEs: typeof approvEn = {
  "papp.subjRoutine": "Rutina",
  "papp.subjChore": "Tarea",
  "papp.subjPractice": "Práctica",
  "papp.subjPrize": "Premio",
  "papp.subjUnknown": "Tarea",
  "papp.subjStake": "Hacer crecer NIM",
  "papp.subjUnstake": "Recuperar NIM",
  "papp.subjGiveTo": "Dar NIM a {name}",
  "papp.subjCashlink": "Enviar un Cashlink",
  "papp.shareOf": "de {amount}",
  "papp.shareNoteLabel": "¿Por qué no todo?",
  "papp.shareNotePh": "La cama sigue desordenada",
  "papp.shareApprove": "Pagar {amount}",
  "papp.shareAll": "Todo",
  "papp.pendingStale": "{name} lleva {days} días esperando",
};

export const approvDe: typeof approvEn = {
  "papp.subjRoutine": "Routine",
  "papp.subjChore": "Aufgabe",
  "papp.subjPractice": "Übung",
  "papp.subjPrize": "Belohnung",
  "papp.subjUnknown": "Aufgabe",
  "papp.subjStake": "NIM wachsen lassen",
  "papp.subjUnstake": "NIM zurückholen",
  "papp.subjGiveTo": "NIM an {name} geben",
  "papp.subjCashlink": "Cashlink senden",
  "papp.shareOf": "von {amount}",
  "papp.shareNoteLabel": "Warum nicht alles?",
  "papp.shareNotePh": "Das Bett ist noch unordentlich",
  "papp.shareApprove": "{amount} zahlen",
  "papp.shareAll": "Alles",
  "papp.pendingStale": "{name} wartet seit {days} Tagen",
};

export const approvFr: typeof approvEn = {
  "papp.subjRoutine": "Routine",
  "papp.subjChore": "Tâche",
  "papp.subjPractice": "Entraînement",
  "papp.subjPrize": "Récompense",
  "papp.subjUnknown": "Tâche",
  "papp.subjStake": "Faire grandir des NIM",
  "papp.subjUnstake": "Récupérer des NIM",
  "papp.subjGiveTo": "Donner des NIM à {name}",
  "papp.subjCashlink": "Envoyer un Cashlink",
  "papp.shareOf": "sur {amount}",
  "papp.shareNoteLabel": "Pourquoi pas tout ?",
  "papp.shareNotePh": "Le lit est encore en désordre",
  "papp.shareApprove": "Payer {amount}",
  "papp.shareAll": "Tout",
  "papp.pendingStale": "{name} attend depuis {days} jours",
};

export const approvPt: typeof approvEn = {
  "papp.subjRoutine": "Rotina",
  "papp.subjChore": "Tarefa",
  "papp.subjPractice": "Prática",
  "papp.subjPrize": "Prêmio",
  "papp.subjUnknown": "Tarefa",
  "papp.subjStake": "Fazer os NIM crescerem",
  "papp.subjUnstake": "Trazer os NIM de volta",
  "papp.subjGiveTo": "Dar NIM para {name}",
  "papp.subjCashlink": "Enviar um Cashlink",
  "papp.shareOf": "de {amount}",
  "papp.shareNoteLabel": "Por que não tudo?",
  "papp.shareNotePh": "A cama ainda está bagunçada",
  "papp.shareApprove": "Pagar {amount}",
  "papp.shareAll": "Tudo",
  "papp.pendingStale": "{name} está à espera há {days} dias",
};
